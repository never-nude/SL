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

MAX_WORKERS = 16
REQUEST_TIMEOUT = 16


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
    t = re.sub(
        r"\s*\((film|movie|tv|tv series|television series|book|novel)\)\s*$",
        "",
        t,
        flags=re.I,
    )
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def norm_text(t):
    return re.sub(r"[^a-z0-9]+", " ", clean_title(t).lower()).strip()


def title_similarity(a, b):
    na = norm_text(a)
    nb = norm_text(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if na in nb or nb in na:
        return 0.85
    aa = set(na.split())
    bb = set(nb.split())
    if not aa or not bb:
        return 0.0
    inter = len(aa.intersection(bb))
    union = len(aa.union(bb))
    return inter / max(1, union)


def parse_year(v):
    if v is None:
        return None
    m = re.search(r"(19|20)\d{2}", str(v))
    return int(m.group(0)) if m else None


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
            f"{t} ({y} television series)" if y else None,
            f"{t} (TV series)",
            f"{t} (television series)",
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
            or ("series" in d)
            or ("(tv" in t)
        )
    return ("novel" in d) or ("book" in d)


def fetch_json_raw(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ScreenLitArtworkRepair/2.0"})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as r:
        raw = r.read()
    return json.loads(raw.decode("utf-8", errors="replace"))


fetch_cache = {}
cache_lock = threading.Lock()


def fetch_json(url):
    with cache_lock:
        if url in fetch_cache:
            return fetch_cache[url]
    data = None
    for attempt in range(4):
        try:
            data = fetch_json_raw(url)
            break
        except Exception:
            time.sleep(0.25 + attempt * 0.35)
    with cache_lock:
        fetch_cache[url] = data
    return data


def fetch_summary(page_title):
    key = page_title.replace(" ", "_")
    url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(key)
    return fetch_json(url)


def wiki_search_titles(query, limit=8):
    url = (
        "https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&origin=*"
        "&srsearch="
        + urllib.parse.quote(query)
        + "&srlimit="
        + str(limit)
    )
    data = fetch_json(url) or {}
    hits = ((data.get("query") or {}).get("search") or [])
    return [h.get("title") for h in hits if h and h.get("title")]


def wiki_art_from_summary(summary):
    return ((summary.get("originalimage") or {}).get("source") or (summary.get("thumbnail") or {}).get("source") or "").strip()


def candidate_score(item, cand_title, cand_year, source):
    sim = title_similarity(cand_title, item.get("title"))
    if sim < 0.5:
        return None

    item_year = parse_year(item.get("year"))
    year_bonus = 3.0
    if item_year and cand_year:
        diff = abs(item_year - cand_year)
        if diff > 18:
            return None
        year_bonus = max(0.0, 15.0 - (diff * 1.4))
    elif item_year and not cand_year:
        year_bonus = 1.5

    source_bonus = {
        "openlibrary": 17.0,
        "tvmaze": 16.0,
        "itunes": 15.0,
        "wiki-direct": 14.0,
        "wiki-search": 11.0,
    }.get(source, 0.0)

    return round(sim * 70.0 + year_bonus + source_bonus, 3)


def upscale_itunes(url):
    return re.sub(r"/\d+x\d+bb\.", "/1200x1200bb.", str(url or ""))


def resolve_from_wikipedia_direct(item):
    expected_type = normalize_type(item.get("type"))
    best = None

    for cand in wiki_candidates(item):
        summary = fetch_summary(cand) or {}
        art = wiki_art_from_summary(summary)
        if not art:
            continue
        if not has_type_signal(summary, expected_type):
            continue
        score = candidate_score(
            item,
            summary.get("title") or cand,
            parse_year(summary.get("description")) or parse_year(summary.get("extract")),
            "wiki-direct",
        )
        if score is None:
            continue
        row = {"url": art, "score": score, "source": "wiki-direct"}
        if not best or row["score"] > best["score"]:
            best = row

    return best


def resolve_from_wikipedia_search(item):
    expected_type = normalize_type(item.get("type"))
    t = clean_title(item.get("title"))
    y = item.get("year") or ""
    type_hint = "film" if expected_type == "Film" else ("TV series" if expected_type == "TV" else "novel")
    query = f"{t} {y} {type_hint}".strip()
    best = None

    for title in wiki_search_titles(query, limit=8):
        summary = fetch_summary(title) or {}
        art = wiki_art_from_summary(summary)
        if not art:
            continue
        if not has_type_signal(summary, expected_type):
            continue
        score = candidate_score(
            item,
            summary.get("title") or title,
            parse_year(summary.get("description")) or parse_year(summary.get("extract")),
            "wiki-search",
        )
        if score is None:
            continue
        row = {"url": art, "score": score, "source": "wiki-search"}
        if not best or row["score"] > best["score"]:
            best = row

    return best


def resolve_from_openlibrary(item):
    if normalize_type(item.get("type")) != "Book":
        return None
    url = (
        "https://openlibrary.org/search.json?title="
        + urllib.parse.quote(clean_title(item.get("title")))
        + "&limit=14"
    )
    data = fetch_json(url) or {}
    docs = data.get("docs") or []
    best = None
    for doc in docs:
        cover_id = doc.get("cover_i")
        if not cover_id:
            continue
        score = candidate_score(
            item,
            doc.get("title") or "",
            parse_year(doc.get("first_publish_year")),
            "openlibrary",
        )
        if score is None:
            continue
        row = {
            "url": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg",
            "score": score,
            "source": "openlibrary",
        }
        if not best or row["score"] > best["score"]:
            best = row
    return best


def resolve_from_tvmaze(item):
    if normalize_type(item.get("type")) != "TV":
        return None
    url = "https://api.tvmaze.com/search/shows?q=" + urllib.parse.quote(clean_title(item.get("title")))
    data = fetch_json(url)
    if not isinstance(data, list):
        return None
    best = None
    for row in data:
        show = (row or {}).get("show") or {}
        image = show.get("image") or {}
        src = image.get("original") or image.get("medium")
        if not src:
            continue
        score = candidate_score(
            item,
            show.get("name") or "",
            parse_year(show.get("premiered")),
            "tvmaze",
        )
        if score is None:
            continue
        cand = {"url": src, "score": score, "source": "tvmaze"}
        if not best or cand["score"] > best["score"]:
            best = cand
    return best


def resolve_from_itunes(item):
    if normalize_type(item.get("type")) != "Film":
        return None
    url = (
        "https://itunes.apple.com/search?entity=movie&limit=14&term="
        + urllib.parse.quote(clean_title(item.get("title")))
    )
    data = fetch_json(url) or {}
    rows = data.get("results") or []
    best = None
    for r in rows:
        src = upscale_itunes(r.get("artworkUrl100") or r.get("artworkUrl60") or "")
        if not src:
            continue
        score = candidate_score(
            item,
            r.get("trackName") or r.get("collectionName") or "",
            parse_year(r.get("releaseDate")),
            "itunes",
        )
        if score is None:
            continue
        cand = {"url": src, "score": score, "source": "itunes"}
        if not best or cand["score"] > best["score"]:
            best = cand
    return best


def existing_score(url, media_type):
    u = str(url or "").strip().lower()
    if not u:
        return 0.0

    if media_type in ("Film", "TV"):
        if "commons.wikimedia.org" in u:
            return 16.0
        if "upload.wikimedia.org" in u and "/wikipedia/en/" in u:
            return 63.0
        if "mzstatic.com" in u:
            return 66.0
        if "tvmaze.com" in u:
            return 65.0
        if "openlibrary.org" in u:
            return 12.0
        return 44.0

    if media_type == "Book":
        if "openlibrary.org" in u:
            return 67.0
        if "upload.wikimedia.org" in u:
            return 56.0
        if "commons.wikimedia.org" in u:
            return 33.0
        return 45.0

    return 40.0


def resolve_item(item, current_url):
    media_type = normalize_type(item.get("type"))
    best_url = str(current_url or "").strip()
    best_score = existing_score(best_url, media_type)
    best_source = "existing-suspect"

    if best_score >= 62.0:
        return {"url": best_url, "source": "existing-trusted", "score": best_score}

    if media_type == "Book":
        c = resolve_from_openlibrary(item)
        if c:
            best_url = c["url"]
            best_score = c["score"]
            best_source = c["source"]
            if best_score >= 58.0:
                return {"url": best_url, "source": best_source, "score": best_score}
    if media_type == "TV":
        c = resolve_from_tvmaze(item)
        if c:
            best_url = c["url"]
            best_score = c["score"]
            best_source = c["source"]
            if best_score >= 58.0:
                return {"url": best_url, "source": best_source, "score": best_score}
    if media_type == "Film":
        c = resolve_from_itunes(item)
        if c:
            best_url = c["url"]
            best_score = c["score"]
            best_source = c["source"]
            if best_score >= 58.0:
                return {"url": best_url, "source": best_source, "score": best_score}

    c = resolve_from_wikipedia_direct(item)
    if c and c["score"] > best_score + 1.0:
        best_url = c["url"]
        best_score = c["score"]
        best_source = c["source"]
    if best_score < 54.0:
        c = resolve_from_wikipedia_search(item)
        if c and c["score"] > best_score + 1.0:
            best_url = c["url"]
            best_score = c["score"]
            best_source = c["source"]

    if best_url:
        return {"url": best_url, "source": best_source, "score": best_score}
    return None


def should_process(item, active_set):
    if item.get("id") not in active_set:
        return False
    t = normalize_type(item.get("type"))
    return t in ("Film", "TV", "Book")


def count_commons_film_tv(targets, overrides):
    count = 0
    for item in targets:
        if normalize_type(item.get("type")) not in ("Film", "TV"):
            continue
        url = str(overrides.get(item["id"]) or "").lower()
        if "commons.wikimedia.org" in url:
            count += 1
    return count


def main():
    started = time.time()
    ctx = load_context()
    catalog = ctx.get("catalog") or []
    pools = ctx.get("pools") or {}
    base_overrides = ctx.get("overrides") or {}

    active_set = set((pools.get("ACTIVE_POOL") or []))
    targets = [i for i in catalog if should_process(i, active_set)]

    commons_before = count_commons_film_tv(targets, base_overrides)

    repaired = {}
    source_counts = {}
    stats = {
        "totalTargets": len(targets),
        "changed": 0,
        "keptExisting": 0,
    }

    resolver_targets = []
    for item in targets:
        current = str(base_overrides.get(item["id"]) or "").strip()
        score = existing_score(current, normalize_type(item.get("type")))
        if current and score >= 62.0:
            repaired[item["id"]] = current
            stats["keptExisting"] += 1
            source_counts["existing-trusted"] = source_counts.get("existing-trusted", 0) + 1
        else:
            resolver_targets.append(item)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        fut = {
            ex.submit(resolve_item, item, base_overrides.get(item["id"])): item
            for item in resolver_targets
        }
        done = 0
        for f in as_completed(fut):
            item = fut[f]
            done += 1
            current = str(base_overrides.get(item["id"]) or "").strip()
            try:
                resolved = f.result()
            except Exception:
                resolved = None

            if resolved and resolved.get("url"):
                url = resolved["url"]
                repaired[item["id"]] = url
                source = resolved.get("source") or "existing"
                source_counts[source] = source_counts.get(source, 0) + 1
                if url != current:
                    stats["changed"] += 1
                else:
                    stats["keptExisting"] += 1
            elif current:
                repaired[item["id"]] = current
                stats["keptExisting"] += 1
                source_counts["existing"] = source_counts.get("existing", 0) + 1

            if done % 80 == 0:
                print("processed", done, "/", len(resolver_targets), flush=True)

    commons_after = count_commons_film_tv(targets, repaired)

    OUT_FILE.write_text(
        "window.SL_ARTWORK_OVERRIDES = Object.assign({}, window.SL_ARTWORK_OVERRIDES || {}, "
        + json.dumps(repaired, ensure_ascii=False, indent=2)
        + ");\n",
        encoding="utf8",
    )

    stats["sourceCounts"] = source_counts
    stats["commonsFilmTvBefore"] = commons_before
    stats["commonsFilmTvAfter"] = commons_after
    stats["generatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    stats["durationSec"] = round(time.time() - started, 2)
    stats["outputCount"] = len(repaired)

    OUT_REPORT.write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps(stats, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
