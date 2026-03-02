#!/usr/bin/env python3
import json
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "artwork_overrides_active.js"
OUT_REPORT = ROOT / "artwork_active_report.json"

MAX_WORKERS = 18
REQUEST_TIMEOUT = 18


def run_node_json(code):
    out = subprocess.check_output(["node", "-e", code], cwd=str(ROOT), text=True)
    return json.loads(out)


def load_context():
    code = r'''
const fs=require('fs'); const vm=require('vm');
const ctx={window:{}}; ctx.window=ctx; vm.createContext(ctx);
const scripts=['catalog.js','catalog_generated.js','catalog_mainstream_generated.js','pools.js','artwork_overrides.js','artwork_overrides_generated.js','artwork_overrides_mainstream_generated.js'];
for(const s of scripts){if(fs.existsSync(s)){const c=fs.readFileSync(s,'utf8'); vm.runInContext(c,ctx,{filename:s});}}
process.stdout.write(JSON.stringify({
  catalog:Array.isArray(ctx.SL_CATALOG)?ctx.SL_CATALOG:[],
  pools:ctx.SL_POOLS||{},
  overrides:(ctx.SL_ARTWORK_OVERRIDES&&typeof ctx.SL_ARTWORK_OVERRIDES==='object')?ctx.SL_ARTWORK_OVERRIDES:{}
}));
'''
    return run_node_json(code)


def normalize_type(t):
    return t if t in ("Film", "TV", "Book") else "Film"


def clean_title(title):
    t = str(title or "").strip()
    t = re.sub(r"\s*\((film|movie|tv|tv series|television series|book|novel)\)\s*$", "", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip()


def wiki_candidates(item):
    t = clean_title(item.get("title"))
    y = int(item.get("year") or 0)
    media = normalize_type(item.get("type"))

    if media == "Film":
        base = [
            f"{t} ({y} film)" if y else None,
            f"{t} (film)",
            t,
        ]
    elif media == "TV":
        base = [
            f"{t} ({y} TV series)" if y else None,
            f"{t} (TV series)",
            f"{t} (American TV series)",
            t,
        ]
    else:
        base = [
            f"{t} ({y} novel)" if y else None,
            f"{t} (novel)",
            f"{t} (book)",
            t,
        ]

    out = []
    seen = set()
    for c in base:
        if not c:
            continue
        k = c.lower().strip()
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(c)
    return out


def has_type_signal(summary, expected_type):
    d = str((summary or {}).get("description") or "").lower()
    t = str((summary or {}).get("title") or "").lower()

    if expected_type == "Film":
        return ("film" in d) or ("(film" in t)
    if expected_type == "TV":
        return (
            ("television" in d)
            or ("tv series" in d)
            or ("tv" in d and "series" in d)
            or ("(tv" in t)
            or ("series" in t)
        )
    return ("novel" in d) or ("book" in d)


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ScreenLitArtworkRepair/1.0"})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as r:
        raw = r.read()
    return json.loads(raw.decode("utf-8", errors="replace"))


summary_cache = {}
cache_lock = threading.Lock()


def fetch_summary(page_title):
    key = page_title.replace(" ", "_")
    with cache_lock:
        if key in summary_cache:
            return summary_cache[key]

    url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(key)
    try:
        data = fetch_json(url)
    except Exception:
        data = None

    with cache_lock:
        summary_cache[key] = data
    return data


def resolve_item(item):
    expected_type = normalize_type(item.get("type"))
    loose = None

    for cand in wiki_candidates(item):
        summary = fetch_summary(cand)
        if not summary:
            continue
        thumb = ((summary.get("thumbnail") or {}).get("source") or "").strip()
        if not thumb:
            continue
        if has_type_signal(summary, expected_type):
            return thumb, "typed"
        if not loose:
            loose = thumb

    if loose:
        return loose, "loose"

    return None, "none"


def should_process(item, active_set):
    if item.get("id") not in active_set:
        return False
    t = normalize_type(item.get("type"))
    return t in ("Film", "TV", "Book")


def main():
    started = time.time()
    ctx = load_context()
    catalog = ctx.get("catalog") or []
    pools = ctx.get("pools") or {}
    base_overrides = ctx.get("overrides") or {}

    active_set = set((pools.get("ACTIVE_POOL") or []))
    targets = [i for i in catalog if should_process(i, active_set)]

    repaired = {}
    stats = {
        "totalTargets": len(targets),
        "typed": 0,
        "loose": 0,
        "keptExisting": 0,
        "changed": 0,
    }

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        fut = {ex.submit(resolve_item, item): item for item in targets}
        done = 0
        for f in as_completed(fut):
            item = fut[f]
            done += 1
            try:
                url, quality = f.result()
            except Exception:
                url, quality = None, "none"

            current = str(base_overrides.get(item["id"]) or "").strip()

            if url:
                repaired[item["id"]] = url
                stats[quality] = stats.get(quality, 0) + 1
                if url != current:
                    stats["changed"] += 1
            elif current:
                repaired[item["id"]] = current
                stats["keptExisting"] += 1

            if done % 150 == 0:
                print("processed", done, "/", len(targets), flush=True)

    OUT_FILE.write_text(
        "window.SL_ARTWORK_OVERRIDES = Object.assign({}, window.SL_ARTWORK_OVERRIDES || {}, "
        + json.dumps(repaired, ensure_ascii=False, indent=2)
        + ");\n",
        encoding="utf8",
    )

    stats["generatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    stats["durationSec"] = round(time.time() - started, 2)
    stats["outputCount"] = len(repaired)

    OUT_REPORT.write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps(stats, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
