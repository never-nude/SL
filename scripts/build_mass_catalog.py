#!/usr/bin/env python3
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG_JS = ROOT / "catalog.js"
OUT_CATALOG = ROOT / "catalog_generated.js"
OUT_OVERRIDES = ROOT / "artwork_overrides_generated.js"
OUT_REPORT = ROOT / "catalog_build_report.json"
MAX_TOTAL_CATALOG = 3000

TARGETS = {
    "film": 800,
    "tv": 600,
    "book": 600,
}

OPENLIB_SUBJECTS = [
    "fiction",
    "classics",
    "fantasy",
    "science_fiction",
    "mystery_and_detective_stories",
    "thrillers",
    "horror",
    "romance",
    "historical_fiction",
    "young_adult_fiction",
    "biography",
    "memoir",
    "literary_fiction",
    "adventure",
    "dystopian",
    "crime_fiction",
    "short_stories",
    "poetry",
]


def log(*args):
    print(*args, flush=True)


def fetch_json(url, retries=4, backoff=0.6, timeout=40):
    headers = {"User-Agent": "ScreenLitCatalogBuilder/1.0 (local build)"}
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception:
            if attempt < retries:
                time.sleep(backoff * (2 ** attempt))
                continue
            return None


def load_catalog_from_script(script_name):
    node_code = rf'''
const fs=require("fs"); const vm=require("vm");
const code=fs.readFileSync("{script_name}","utf8");
const ctx={{window:{{}}}}; ctx.window=ctx; vm.createContext(ctx); vm.runInContext(code,ctx);
process.stdout.write(JSON.stringify(Array.isArray(ctx.SL_CATALOG)?ctx.SL_CATALOG:[]));
'''
    out = subprocess.check_output(["node", "-e", node_code], cwd=str(ROOT), text=True)
    return json.loads(out)


def load_overrides_from_script(script_name):
    node_code = rf'''
const fs=require("fs"); const vm=require("vm");
const code=fs.readFileSync("{script_name}","utf8");
const ctx={{window:{{}}}}; ctx.window=ctx; vm.createContext(ctx); vm.runInContext(code,ctx);
const map=(ctx.SL_ARTWORK_OVERRIDES && typeof ctx.SL_ARTWORK_OVERRIDES==="object") ? ctx.SL_ARTWORK_OVERRIDES : {{}};
process.stdout.write(JSON.stringify(map));
'''
    out = subprocess.check_output(["node", "-e", node_code], cwd=str(ROOT), text=True)
    return json.loads(out)


def load_base_catalog():
    node_code = r'''
const fs=require("fs"); const vm=require("vm");
const code=fs.readFileSync("catalog.js","utf8");
const ctx={window:{}}; ctx.window=ctx; vm.createContext(ctx); vm.runInContext(code,ctx);
process.stdout.write(JSON.stringify(Array.isArray(ctx.SL_CATALOG)?ctx.SL_CATALOG:[]));
'''
    out = subprocess.check_output(["node", "-e", node_code], cwd=str(ROOT), text=True)
    return json.loads(out)


def title_key(title):
    t = (title or "").lower()
    t = t.replace("’", "'").replace("‘", "'")
    t = re.sub(r"\((film|book|tv|novel|series|television)\)", "", t, flags=re.I)
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return t


def entry_key(media_type, title, year):
    return f"{media_type}|{title_key(title)}|{int(year) if year else 0}"


def unique_push(target, item, image_url, state):
    if not item.get("id") or not item.get("title") or not item.get("type") or not item.get("year"):
        return False
    if not image_url:
        return False

    k = entry_key(item["type"], item["title"], item["year"])
    if item["id"] in state["id_seen"]:
        return False
    if k in state["key_seen"]:
        return False

    state["id_seen"].add(item["id"])
    state["key_seen"].add(k)
    target.append(item)
    state["overrides"][item["id"]] = image_url
    return True


def wiki_title_from_article(url):
    if not url or "/wiki/" not in url:
        return ""
    return urllib.parse.unquote(url.split("/wiki/", 1)[1])


def build_films(state, target):
    added = []

    year_windows = [
        (2020, 2025),
        (2015, 2019),
        (2010, 2014),
        (2000, 2009),
        (1990, 1999),
        (1980, 1989),
        (1970, 1979),
        (1960, 1969),
        (1950, 1959),
        (1900, 1949),
    ]

    seen_qids = set()

    for start, end in year_windows:
        if len(added) >= target:
            break

        query = f"""
SELECT ?item ?itemLabel ?pub ?img WHERE {{
  ?item wdt:P31/wdt:P279* wd:Q11424;
        wdt:P577 ?pub;
        wdt:P18 ?img.
  BIND(YEAR(?pub) AS ?y)
  FILTER(?y >= {start} && ?y <= {end})
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
LIMIT 700
"""

        url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(query)
        data = fetch_json(url, retries=5, backoff=0.8, timeout=60)
        rows = (((data or {}).get("results") or {}).get("bindings") or [])

        for row in rows:
            if len(added) >= target:
                break

            item_url = ((row.get("item") or {}).get("value") or "")
            qid = item_url.rsplit("/", 1)[-1]
            if not qid or qid in seen_qids:
                continue
            seen_qids.add(qid)

            label = ((row.get("itemLabel") or {}).get("value") or "").strip()
            label = re.sub(r"\\s+\\(film\\)$", "", label, flags=re.I)

            pub = ((row.get("pub") or {}).get("value") or "")
            year = int(pub[:4]) if len(pub) >= 4 and pub[:4].isdigit() else 0
            if not label or not (1900 <= year <= 2025):
                continue

            img = ((row.get("img") or {}).get("value") or "").strip()
            if not img:
                continue

            item = {
                "id": f"film_wd_{qid.lower()}_{year}",
                "title": label,
                "type": "Film",
                "year": year,
            }
            unique_push(added, item, img, state)

        log("film window", f"{start}-{end}", "added", len(added), "/", target)

    return added


def build_tv(state, target):
    added = []

    for page in range(0, 120):
        if len(added) >= target:
            break
        url = f"https://api.tvmaze.com/shows?page={page}"
        arr = fetch_json(url, retries=4, backoff=0.35, timeout=30)
        if not isinstance(arr, list) or not arr:
            break

        for show in arr:
            if len(added) >= target:
                break
            if not show or not show.get("id") or not show.get("name"):
                continue

            premiered = str(show.get("premiered") or "")
            year = int(premiered[:4]) if len(premiered) >= 4 and premiered[:4].isdigit() else 0
            if not (1950 <= year <= 2025):
                continue

            image = show.get("image") or {}
            image_url = image.get("original") or image.get("medium")
            if not image_url:
                continue

            item = {
                "id": f"tv_tmz_{show['id']}_{year}",
                "title": str(show.get("name")).strip(),
                "type": "TV",
                "year": year,
            }
            unique_push(added, item, image_url, state)

        if page % 10 == 0:
            log("tv page", page, "added", len(added), "/", target)

    return added


def build_books(state, target):
    added = []
    offsets = list(range(0, 1000, 100))

    for subject in OPENLIB_SUBJECTS:
        for offset in offsets:
            if len(added) >= target:
                break
            url = (
                "https://openlibrary.org/subjects/"
                + urllib.parse.quote(subject)
                + f".json?limit=100&offset={offset}"
            )
            data = fetch_json(url, retries=4, backoff=0.35, timeout=30)
            works = (data or {}).get("works") or []
            for work in works:
                if len(added) >= target:
                    break
                if not work or not work.get("key") or not work.get("title") or not work.get("cover_id"):
                    continue

                y = work.get("first_publish_year")
                year = int(y) if isinstance(y, int) or (isinstance(y, str) and y.isdigit()) else 0
                if not (1800 <= year <= 2025):
                    continue

                key = str(work.get("key")).split("/")[-1]
                if not key:
                    continue

                item = {
                    "id": f"book_ol_{key.lower()}_{year}",
                    "title": str(work.get("title")).strip(),
                    "type": "Book",
                    "year": year,
                }
                img = f"https://covers.openlibrary.org/b/id/{work['cover_id']}-L.jpg"
                unique_push(added, item, img, state)

        log("book subject", subject, "added", len(added), "/", target)
        if len(added) >= target:
            break

    return added


def write_outputs(generated, overrides):
    OUT_CATALOG.write_text(
        "window.SL_CATALOG = (window.SL_CATALOG || []).concat("
        + json.dumps(generated, ensure_ascii=False, indent=2)
        + ");\n",
        encoding="utf8",
    )

    OUT_OVERRIDES.write_text(
        "window.SL_ARTWORK_OVERRIDES = Object.assign({}, window.SL_ARTWORK_OVERRIDES || {}, "
        + json.dumps(overrides, ensure_ascii=False, indent=2)
        + ");\n",
        encoding="utf8",
    )


def main():
    log("Starting mass catalog build")
    base = load_base_catalog()
    log("base catalog", len(base))
    existing_generated = []
    existing_generated_overrides = {}

    if OUT_CATALOG.exists():
        try:
            existing_generated = load_catalog_from_script("catalog_generated.js")
        except Exception:
            existing_generated = []

    if OUT_OVERRIDES.exists():
        try:
            existing_generated_overrides = load_overrides_from_script("artwork_overrides_generated.js")
        except Exception:
            existing_generated_overrides = {}

    log("existing generated", len(existing_generated))

    state = {
        "id_seen": set(),
        "key_seen": set(),
        "overrides": dict(existing_generated_overrides),
    }

    for item in base:
        if not item or not item.get("id"):
            continue
        state["id_seen"].add(item["id"])
        state["key_seen"].add(entry_key(item.get("type"), item.get("title"), item.get("year")))

    filtered_existing_generated = []
    for item in existing_generated:
        if not item or not item.get("id"):
            continue
        k = entry_key(item.get("type"), item.get("title"), item.get("year"))
        if item["id"] in state["id_seen"] or k in state["key_seen"]:
            continue
        state["id_seen"].add(item["id"])
        state["key_seen"].add(k)
        filtered_existing_generated.append(item)

    max_generated = max(0, MAX_TOTAL_CATALOG - len(base))
    capacity = max(0, max_generated - len(filtered_existing_generated))

    target_sum = TARGETS["film"] + TARGETS["tv"] + TARGETS["book"]
    film_target = min(TARGETS["film"], int(round(capacity * (TARGETS["film"] / target_sum)))) if capacity else 0
    tv_target = min(TARGETS["tv"], int(round(capacity * (TARGETS["tv"] / target_sum)))) if capacity else 0
    book_target = min(TARGETS["book"], capacity - film_target - tv_target) if capacity else 0
    if book_target < 0:
        book_target = 0
    if film_target + tv_target + book_target < capacity:
        book_target = min(TARGETS["book"], book_target + (capacity - (film_target + tv_target + book_target)))

    log("capacity for new items", capacity, "targets", {"film": film_target, "tv": tv_target, "book": book_target})

    films = build_films(state, film_target) if film_target else []
    tv = build_tv(state, tv_target) if tv_target else []
    books = build_books(state, book_target) if book_target else []

    new_items = films + tv + books
    generated = filtered_existing_generated + new_items

    if len(generated) > max_generated:
        generated = sorted(generated, key=lambda x: int(x.get("year") or 0), reverse=True)[:max_generated]
        keep_ids = {x.get("id") for x in generated if x.get("id")}
        state["overrides"] = {k: v for (k, v) in state["overrides"].items() if k in keep_ids}

    write_outputs(generated, state["overrides"])

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "baseCount": len(base),
        "existingGeneratedCount": len(filtered_existing_generated),
        "newlyAddedCount": len(new_items),
        "generatedCount": len(generated),
        "totalCatalogCount": len(base) + len(generated),
        "addedByType": {
            "film": len(films),
            "tv": len(tv),
            "book": len(books),
        },
        "overrideCount": len(state["overrides"]),
        "targets": TARGETS,
        "maxTotalCatalog": MAX_TOTAL_CATALOG,
    }

    OUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    log(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
