#!/usr/bin/env python3
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_CATALOG = ROOT / "catalog_mainstream_generated.js"
OUT_OVERRIDES = ROOT / "artwork_overrides_mainstream_generated.js"
OUT_REPORT = ROOT / "catalog_mainstream_report.json"

RECENT_CUTOFF_YEAR = 2016
TARGETS = {
    "film": 520,
    "tv": 420,
    "book": 560,
}
PRE_2016_SHARE = {
    "film": 0.78,
    "tv": 0.72,
    "book": 0.9,
}

FILM_QUERIES = [
    (2010, 2025, 14, 420),
    (2000, 2009, 12, 400),
    (1990, 1999, 10, 360),
    (1980, 1989, 9, 320),
    (1970, 1979, 8, 280),
    (1960, 1969, 7, 260),
    (1950, 1959, 6, 240),
]

TV_QUERIES = [
    (2010, 2025, 12, 440),
    (1990, 2009, 10, 420),
    (1950, 1989, 8, 360),
]

BOOK_SUBJECTS = [
    "fiction",
    "classics",
    "fantasy",
    "science_fiction",
    "mystery_and_detective_stories",
    "thrillers",
    "romance",
    "historical_fiction",
    "young_adult_fiction",
    "horror",
    "biography",
    "memoir",
    "literary_fiction",
]

BOOK_QUERIES = [
    "best sellers",
    "classic novels",
    "popular fiction",
    "award winning novels",
    "mystery novels",
    "science fiction novels",
    "fantasy novels",
    "romance novels",
    "thriller novels",
]


def log(*args):
    print(*args, flush=True)


def fetch_json(url, retries=5, backoff=0.6, timeout=70):
    headers = {"User-Agent": "ScreenLitMainstreamBuilder/1.0"}
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as response:
                raw = response.read()
            text = raw.decode("utf-8", errors="replace")
            return json.loads(text)
        except Exception:
            if attempt >= retries:
                return None
            time.sleep(backoff * (2 ** attempt))
    return None


def load_catalog_from_scripts(script_names):
    import subprocess

    scripts_json = json.dumps(script_names)
    node_code = f"""
const fs = require('fs');
const vm = require('vm');
const scripts = {scripts_json};
const ctx = {{ window: {{}} }};
ctx.window = ctx;
vm.createContext(ctx);
for (const script of scripts) {{
  if (!fs.existsSync(script)) continue;
  const code = fs.readFileSync(script, 'utf8');
  vm.runInContext(code, ctx, {{ filename: script }});
}}
process.stdout.write(JSON.stringify(Array.isArray(ctx.SL_CATALOG) ? ctx.SL_CATALOG : []));
"""
    out = subprocess.check_output(["node", "-e", node_code], cwd=str(ROOT), text=True)
    return json.loads(out)


def load_overrides_from_scripts(script_names):
    import subprocess

    scripts_json = json.dumps(script_names)
    node_code = f"""
const fs = require('fs');
const vm = require('vm');
const scripts = {scripts_json};
const ctx = {{ window: {{}} }};
ctx.window = ctx;
vm.createContext(ctx);
for (const script of scripts) {{
  if (!fs.existsSync(script)) continue;
  const code = fs.readFileSync(script, 'utf8');
  vm.runInContext(code, ctx, {{ filename: script }});
}}
const map = (ctx.SL_ARTWORK_OVERRIDES && typeof ctx.SL_ARTWORK_OVERRIDES === 'object') ? ctx.SL_ARTWORK_OVERRIDES : {{}};
process.stdout.write(JSON.stringify(map));
"""
    out = subprocess.check_output(["node", "-e", node_code], cwd=str(ROOT), text=True)
    return json.loads(out)


def title_key(title):
    t = (title or "").lower()
    t = t.replace("’", "'").replace("‘", "'")
    t = re.sub(r"\([^)]*\)", "", t)
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return t


def entry_key(media_type, title, year):
    return f"{media_type}|{title_key(title)}|{int(year) if year else 0}"


def looks_bad_title(title):
    t = (title or "").strip()
    if not t:
        return True
    if re.match(r"^Q\d+$", t):
        return True
    if len(t) < 2:
        return True
    if re.search(r"^(untitled|episode\s+\d+|pilot)$", t, flags=re.I):
        return True
    if re.search(r"\b(season|episode|volume\s+\d+)\b", t, flags=re.I):
        return True
    return False


def normalize_title(title, media_type):
    t = (title or "").strip()
    if media_type == "Film":
        t = re.sub(r"\s*\((film|movie)\)\s*$", "", t, flags=re.I)
    elif media_type == "TV":
        t = re.sub(r"\s*\((tv\s*series|television\s*series|series)\)\s*$", "", t, flags=re.I)
    elif media_type == "Book":
        t = re.sub(r"\s*\((novel|book)\)\s*$", "", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip()


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


def wikidata_query_candidates(instance_qid, date_prop, start_year, end_year, min_sitelinks, limit):
    query = f"""
SELECT ?item ?itemLabel ?date ?img ?sitelinks WHERE {{
  ?item wdt:P31/wdt:P279* wd:{instance_qid};
        wdt:{date_prop} ?date;
        wdt:P18 ?img;
        wikibase:sitelinks ?sitelinks.
  BIND(YEAR(?date) AS ?year)
  FILTER(?year >= {start_year} && ?year <= {end_year})
  FILTER(?sitelinks >= {min_sitelinks})
  ?enArticle schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>.
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
LIMIT {limit}
"""

    url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(query)
    data = fetch_json(url, retries=6, backoff=0.8, timeout=95)
    rows = (((data or {}).get("results") or {}).get("bindings") or [])

    out = []
    for row in rows:
        item_url = ((row.get("item") or {}).get("value") or "")
        qid = item_url.rsplit("/", 1)[-1]

        label = ((row.get("itemLabel") or {}).get("value") or "").strip()
        date = ((row.get("date") or {}).get("value") or "")
        year = int(date[:4]) if len(date) >= 4 and date[:4].isdigit() else 0
        img = ((row.get("img") or {}).get("value") or "").strip()
        sitelinks_raw = ((row.get("sitelinks") or {}).get("value") or "0").strip()

        if not qid or not label or not img or not (1850 <= year <= 2025):
            continue

        try:
            sitelinks = int(float(sitelinks_raw))
        except Exception:
            sitelinks = 0

        out.append(
            {
                "qid": qid,
                "title": label,
                "year": year,
                "image": img,
                "sitelinks": sitelinks,
            }
        )

    return out


def collapse_wikidata_candidates(rows, media_type):
    by_qid = {}

    for row in rows:
        qid = row["qid"]
        title = normalize_title(row["title"], media_type)

        if looks_bad_title(title):
            continue

        if qid not in by_qid:
            by_qid[qid] = {
                "qid": qid,
                "title": title,
                "year": row["year"],
                "image": row["image"],
                "sitelinks": row["sitelinks"],
            }
            continue

        prev = by_qid[qid]
        prev["year"] = min(prev["year"], row["year"])

        if row["sitelinks"] > prev["sitelinks"]:
            prev["sitelinks"] = row["sitelinks"]
            prev["title"] = title
            prev["image"] = row["image"]

    return list(by_qid.values())


def score_year_bias(year):
    if not year:
        return 0
    if year <= 1989:
        return 18
    if year <= 2005:
        return 14
    if year <= 2015:
        return 10
    if year <= 2020:
        return 4
    return 0


def pick_with_pre2016_bias(candidates, target_count, pre_share):
    pre = [c for c in candidates if c.get("year", 0) < RECENT_CUTOFF_YEAR]
    recent = [c for c in candidates if c.get("year", 0) >= RECENT_CUTOFF_YEAR]

    pre_target = int(round(target_count * pre_share))
    pre_target = min(pre_target, len(pre))

    chosen = pre[:pre_target]
    remaining = target_count - len(chosen)

    if remaining > 0:
        chosen.extend(recent[:remaining])
        remaining = target_count - len(chosen)

    if remaining > 0:
        leftovers = pre[pre_target:] + recent[len(chosen) - pre_target :]
        chosen.extend(leftovers[:remaining])

    return chosen[:target_count]


def build_films(state):
    rows = []
    for start, end, min_links, limit in FILM_QUERIES:
        part = wikidata_query_candidates("Q11424", "P577", start, end, min_links, limit)
        rows.extend(part)
        log("film query", f"{start}-{end}", "rows", len(part), "total", len(rows))

    collapsed = collapse_wikidata_candidates(rows, "Film")

    for c in collapsed:
        c["score"] = c["sitelinks"] * 1.0 + score_year_bias(c["year"])

    collapsed.sort(key=lambda x: (x["score"], x["sitelinks"], x["year"]), reverse=True)
    picked = pick_with_pre2016_bias(collapsed, TARGETS["film"], PRE_2016_SHARE["film"])

    out = []
    for c in picked:
        item = {
            "id": f"film_pop_wd_{c['qid'].lower()}_{int(c['year'])}",
            "title": c["title"],
            "type": "Film",
            "year": int(c["year"]),
            "mainstream": True,
        }
        unique_push(out, item, c["image"], state)

    return out


def build_tv(state):
    rows = []
    for start, end, min_links, limit in TV_QUERIES:
        part = wikidata_query_candidates("Q5398426", "P580", start, end, min_links, limit)
        rows.extend(part)
        log("tv query", f"{start}-{end}", "rows", len(part), "total", len(rows))

    collapsed = collapse_wikidata_candidates(rows, "TV")

    for c in collapsed:
        c["score"] = c["sitelinks"] * 1.0 + score_year_bias(c["year"])

    collapsed.sort(key=lambda x: (x["score"], x["sitelinks"], x["year"]), reverse=True)
    picked = pick_with_pre2016_bias(collapsed, TARGETS["tv"], PRE_2016_SHARE["tv"])

    out = []
    for c in picked:
        item = {
            "id": f"tv_pop_wd_{c['qid'].lower()}_{int(c['year'])}",
            "title": c["title"],
            "type": "TV",
            "year": int(c["year"]),
            "mainstream": True,
        }
        unique_push(out, item, c["image"], state)

    return out


def openlibrary_subject_candidates():
    out = []
    for subject in BOOK_SUBJECTS:
        for offset in range(0, 1000, 100):
            url = (
                "https://openlibrary.org/subjects/"
                + urllib.parse.quote(subject)
                + f".json?limit=100&offset={offset}&details=true"
            )
            data = fetch_json(url, retries=4, backoff=0.35, timeout=50)
            works = (data or {}).get("works") or []
            if not works:
                break

            for work in works:
                title = str(work.get("title") or "").strip()
                key = str(work.get("key") or "").strip()
                cover_id = work.get("cover_id")
                year = work.get("first_publish_year")
                edition_count = work.get("edition_count") or 0

                if not title or not key or not cover_id:
                    continue
                if not isinstance(year, int):
                    continue
                if not (1850 <= year <= 2025):
                    continue

                out.append(
                    {
                        "key": key.split("/")[-1].lower(),
                        "title": normalize_title(title, "Book"),
                        "year": int(year),
                        "image": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg",
                        "score": float(edition_count or 0),
                    }
                )

            if offset % 200 == 0:
                log("book subject", subject, "offset", offset, "rows", len(out))

    return out


def openlibrary_search_candidates():
    out = []
    for q in BOOK_QUERIES:
        for page in range(1, 12):
            url = (
                "https://openlibrary.org/search.json?q="
                + urllib.parse.quote(q)
                + "&language=eng&has_fulltext=false&sort=editions"
                + f"&limit=100&page={page}"
            )
            data = fetch_json(url, retries=4, backoff=0.35, timeout=50)
            docs = (data or {}).get("docs") or []
            if not docs:
                break

            for doc in docs:
                title = str(doc.get("title") or "").strip()
                key = str(doc.get("key") or "").strip()
                cover_id = doc.get("cover_i")
                year = doc.get("first_publish_year")
                edition_count = doc.get("edition_count") or 0

                if not title or not key or not cover_id:
                    continue
                if not isinstance(year, int):
                    continue
                if not (1850 <= year <= 2025):
                    continue
                if "/works/" not in key:
                    continue

                out.append(
                    {
                        "key": key.split("/")[-1].lower(),
                        "title": normalize_title(title, "Book"),
                        "year": int(year),
                        "image": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg",
                        "score": float(edition_count or 0),
                    }
                )

            if page % 4 == 0:
                log("book query", q, "page", page, "rows", len(out))

    return out


def collapse_book_candidates(rows):
    by_key = {}

    for row in rows:
        key = row["key"]
        title = row["title"]

        if looks_bad_title(title):
            continue

        if key not in by_key:
            by_key[key] = dict(row)
            continue

        prev = by_key[key]
        prev["year"] = min(prev["year"], row["year"])
        if row["score"] > prev["score"]:
            prev["score"] = row["score"]
            prev["title"] = title
            prev["image"] = row["image"]

    return list(by_key.values())


def build_books(state):
    subject_rows = openlibrary_subject_candidates()
    query_rows = openlibrary_search_candidates()
    collapsed = collapse_book_candidates(subject_rows + query_rows)

    for c in collapsed:
        c["score"] = c["score"] * 1.0 + score_year_bias(c["year"])

    collapsed.sort(key=lambda x: (x["score"], x["year"]), reverse=True)
    picked = pick_with_pre2016_bias(collapsed, TARGETS["book"], PRE_2016_SHARE["book"])

    out = []
    for c in picked:
        item = {
            "id": f"book_pop_ol_{c['key']}_{int(c['year'])}",
            "title": c["title"],
            "type": "Book",
            "year": int(c["year"]),
            "mainstream": True,
        }
        unique_push(out, item, c["image"], state)

    return out


def write_outputs(items, overrides):
    OUT_CATALOG.write_text(
        "window.SL_CATALOG = (window.SL_CATALOG || []).concat("
        + json.dumps(items, ensure_ascii=False, indent=2)
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
    log("Building mainstream expansion catalog")

    catalog_scripts = ["catalog.js", "catalog_generated.js"]
    if OUT_CATALOG.exists():
        catalog_scripts.append(OUT_CATALOG.name)

    all_existing_catalog = load_catalog_from_scripts(catalog_scripts)

    override_scripts = ["artwork_overrides.js", "artwork_overrides_generated.js"]
    if OUT_OVERRIDES.exists():
        override_scripts.append(OUT_OVERRIDES.name)

    all_existing_overrides = load_overrides_from_scripts(override_scripts)

    state = {
        "id_seen": set(),
        "key_seen": set(),
        "overrides": dict(all_existing_overrides),
    }

    for item in all_existing_catalog:
        if not item or not item.get("id"):
            continue
        state["id_seen"].add(item["id"])
        state["key_seen"].add(entry_key(item.get("type"), item.get("title"), item.get("year")))

    film = build_films(state)
    tv = build_tv(state)
    book = build_books(state)

    items = film + tv + book

    write_outputs(items, state["overrides"])

    total = len(items)
    pre = len([x for x in items if int(x.get("year") or 0) < RECENT_CUTOFF_YEAR])
    mainstream = len([x for x in items if x.get("mainstream") is True])

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "newCount": total,
        "byType": {
            "film": len(film),
            "tv": len(tv),
            "book": len(book),
        },
        "mainstreamPct": round((mainstream / total) * 100, 1) if total else 0,
        "pre2016Pct": round((pre / total) * 100, 1) if total else 0,
        "targets": TARGETS,
        "pre2016ShareTarget": PRE_2016_SHARE,
        "overrideCount": len(state["overrides"]),
    }

    OUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    log(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
