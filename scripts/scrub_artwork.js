#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.resolve(__dirname, "..");
var CATALOG_PATH = path.join(ROOT, "catalog.js");
var OUT_OVERRIDES_JS = path.join(ROOT, "artwork_overrides.js");
var OUT_REPORT_JSON = path.join(ROOT, "artwork_scrub_report.json");
var FORCE_REFRESH = process.argv.indexOf("--refresh") !== -1;

function loadCatalog() {
  var code = fs.readFileSync(CATALOG_PATH, "utf8");
  var ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "catalog.js" });
  return ctx.window.SL_CATALOG || [];
}

function loadExistingOverrides() {
  if (!fs.existsSync(OUT_OVERRIDES_JS)) return {};
  try {
    var code = fs.readFileSync(OUT_OVERRIDES_JS, "utf8");
    var ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(code, ctx, { filename: "artwork_overrides.js" });
    return ctx.window.SL_ARTWORK_OVERRIDES || {};
  } catch (e) {
    return {};
  }
}

function normalizeType(t) {
  if (t === "Film" || t === "TV" || t === "Book") return t;
  return "Film";
}

function cleanTitle(t) {
  return String(t || "")
    .replace(/\s+\((film|book|tv)\)$/i, "")
    .replace(/[’]/g, "'")
    .trim();
}

function norm(s) {
  return cleanTitle(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupe(arr) {
  var out = [];
  var seen = {};
  for (var i = 0; i < arr.length; i++) {
    var v = String(arr[i] || "").trim();
    if (!v || seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out;
}

function wikiCandidates(item) {
  var t = cleanTitle(item.title);
  var y = Number(item.year) || "";
  var type = normalizeType(item.type);
  if (type === "Film") {
    return dedupe([t + " (" + y + " film)", t + " (film)", t]);
  }
  if (type === "TV") {
    return dedupe([t + " (" + y + " TV series)", t + " (TV series)", t + " (television series)", t]);
  }
  return dedupe([t + " (" + y + " novel)", t + " (novel)", t + " (book)", t]);
}

function titleSimilarity(a, b) {
  var na = norm(a);
  var nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return 0.82;
  var as = na.split(" ");
  var bs = nb.split(" ");
  var common = 0;
  var seen = {};
  for (var i = 0; i < as.length; i++) seen[as[i]] = true;
  for (var j = 0; j < bs.length; j++) if (seen[bs[j]]) common += 1;
  return common / Math.max(as.length, bs.length, 1);
}

function hasTypeSignalFromTitle(pageTitle, expectedType) {
  var t = String(pageTitle || "").toLowerCase();
  if (expectedType === "Film") return t.indexOf("(film)") !== -1;
  if (expectedType === "TV") return t.indexOf("tv") !== -1 || t.indexOf("television") !== -1 || t.indexOf("series") !== -1;
  return t.indexOf("(novel)") !== -1 || t.indexOf("(book)") !== -1;
}

async function fetchJson(url, timeoutMs) {
  for (var attempt = 0; attempt < 5; attempt++) {
    var ac = new AbortController();
    var to = setTimeout(function () {
      ac.abort();
    }, timeoutMs || 12000);
    try {
      var res = await fetch(url, {
        signal: ac.signal,
        headers: {
          "User-Agent": "ScreenLitArtworkScrub/1.0"
        }
      });

      if (res.status === 429 || res.status === 503) {
        await sleep(500 + attempt * 900);
        continue;
      }

      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      if (attempt < 4) {
        await sleep(400 + attempt * 700);
        continue;
      }
      return null;
    } finally {
      clearTimeout(to);
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function wikiSummary(pageTitle) {
  var page = String(pageTitle || "").replace(/ /g, "_");
  var url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(page);
  var j = await fetchJson(url, 12000);
  if (!j || !j.title) return null;
  var src = (j.originalimage && j.originalimage.source) || (j.thumbnail && j.thumbnail.source) || null;
  if (!src) return null;
  return {
    url: src,
    pageTitle: j.title,
    wikibase: j.wikibase_item || null
  };
}

async function wikiPageImage(pageTitle) {
  var url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&titles=" +
    encodeURIComponent(pageTitle) +
    "&prop=pageimages|info&inprop=url&piprop=original|thumbnail&pithumbsize=1400&origin=*";
  var j = await fetchJson(url, 15000);
  if (!j || !j.query || !j.query.pages) return null;
  var keys = Object.keys(j.query.pages);
  if (!keys.length) return null;
  var p = j.query.pages[keys[0]];
  if (!p || p.missing) return null;
  var src = (p.original && p.original.source) || (p.thumbnail && p.thumbnail.source) || null;
  if (!src) return null;
  return {
    url: src,
    pageTitle: p.title,
    wikibase: null
  };
}

async function resolveFromWikiCandidates(item) {
  var cands = wikiCandidates(item);
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < cands.length; i++) {
    var hit = await wikiPageImage(cands[i]);
    if (!hit) hit = await wikiSummary(cands[i]);
    if (!hit) continue;
    var score = titleSimilarity(hit.pageTitle, item.title) * 5;
    if (hasTypeSignalFromTitle(hit.pageTitle, normalizeType(item.type))) score += 2;
    if (String(hit.pageTitle).indexOf(String(item.year)) !== -1) score += 1.5;
    if (score > bestScore) {
      best = hit;
      bestScore = score;
    }
    if (score >= 7.5) break;
  }
  return best;
}

async function resolveFromWikiSearch(item) {
  var typeHint = normalizeType(item.type) === "Film"
    ? "film"
    : (normalizeType(item.type) === "TV" ? "TV series" : "novel");
  var q = cleanTitle(item.title) + " " + item.year + " " + typeHint;
  var url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=" +
    encodeURIComponent(q) +
    "&gsrlimit=10&prop=pageimages|info&inprop=url&piprop=original|thumbnail&pithumbsize=1200&origin=*";
  var data = await fetchJson(url, 15000);
  if (!data || !data.query || !data.query.pages) return null;

  var pages = Object.keys(data.query.pages).map(function (k) {
    return data.query.pages[k];
  });
  if (!pages.length) return null;

  var best = null;
  var bestScore = -1;
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    if (!p) continue;
    var src = (p.original && p.original.source) || (p.thumbnail && p.thumbnail.source) || null;
    if (!src) continue;
    var score = titleSimilarity(p.title, item.title) * 6;
    if (hasTypeSignalFromTitle(p.title, normalizeType(item.type))) score += 1.7;
    if (String(p.title).indexOf(String(item.year)) !== -1) score += 1.2;
    if (score > bestScore) {
      bestScore = score;
      best = {
        url: src,
        pageTitle: p.title,
        wikibase: null
      };
    }
  }
  return best;
}

async function resolveFromWikiSearchSummaries(item) {
  var typeHint = normalizeType(item.type) === "Film"
    ? "film"
    : (normalizeType(item.type) === "TV" ? "TV series" : "novel");
  var q = cleanTitle(item.title) + " " + item.year + " " + typeHint;
  var url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=" +
    encodeURIComponent(q) +
    "&srlimit=8&origin=*";
  var data = await fetchJson(url, 15000);
  if (!data || !data.query || !Array.isArray(data.query.search)) return null;

  var best = null;
  var bestScore = -1;
  for (var i = 0; i < data.query.search.length; i++) {
    var hit = data.query.search[i];
    if (!hit || !hit.title) continue;
    var summary = await wikiSummary(hit.title);
    if (!summary) continue;
    var score = titleSimilarity(summary.pageTitle, item.title) * 6;
    if (hasTypeSignalFromTitle(summary.pageTitle, normalizeType(item.type))) score += 2;
    if (String(summary.pageTitle).indexOf(String(item.year)) !== -1) score += 1.2;
    if (score > bestScore) {
      bestScore = score;
      best = summary;
    }
    if (score >= 7.6) break;
  }
  return best;
}

function parseWikidataImageName(entity) {
  if (!entity || !entity.claims || !entity.claims.P18 || !entity.claims.P18.length) return null;
  var claim = entity.claims.P18[0];
  if (!claim || !claim.mainsnak || !claim.mainsnak.datavalue) return null;
  return claim.mainsnak.datavalue.value || null;
}

async function resolveFromWikidata(wikibaseId) {
  if (!wikibaseId) return null;
  var wdUrl =
    "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=" +
    encodeURIComponent(wikibaseId) +
    "&origin=*";
  var wd = await fetchJson(wdUrl, 15000);
  if (!wd || !wd.entities || !wd.entities[wikibaseId]) return null;
  var fileName = parseWikidataImageName(wd.entities[wikibaseId]);
  if (!fileName) return null;

  var commonsUrl =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=File:" +
    encodeURIComponent(fileName) +
    "&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1400&origin=*";
  var commons = await fetchJson(commonsUrl, 15000);
  if (!commons || !commons.query || !commons.query.pages) return null;
  var pages = commons.query.pages;
  var firstKey = Object.keys(pages)[0];
  if (!firstKey) return null;
  var info = pages[firstKey] && pages[firstKey].imageinfo && pages[firstKey].imageinfo[0];
  if (!info) return null;
  return info.thumburl || info.url || null;
}

async function resolveBookFromOpenLibrary(item) {
  if (normalizeType(item.type) !== "Book") return null;
  var url =
    "https://openlibrary.org/search.json?title=" +
    encodeURIComponent(cleanTitle(item.title)) +
    "&limit=12";
  var data = await fetchJson(url, 12000);
  if (!data || !Array.isArray(data.docs) || !data.docs.length) return null;
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < data.docs.length; i++) {
    var d = data.docs[i];
    if (!d || !d.cover_i) continue;
    var score = titleSimilarity(d.title || "", item.title) * 6;
    if (d.first_publish_year && item.year) {
      var diff = Math.abs(Number(d.first_publish_year) - Number(item.year));
      score += Math.max(0, 2 - Math.min(2, diff / 6));
    }
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  if (!best) return null;
  return "https://covers.openlibrary.org/b/id/" + best.cover_i + "-L.jpg";
}

async function resolveTVFromTVMaze(item) {
  if (normalizeType(item.type) !== "TV") return null;
  var url = "https://api.tvmaze.com/search/shows?q=" + encodeURIComponent(cleanTitle(item.title));
  var data = await fetchJson(url, 12000);
  if (!Array.isArray(data) || !data.length) return null;
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < data.length; i++) {
    var show = data[i] && data[i].show;
    if (!show) continue;
    var src = (show.image && (show.image.original || show.image.medium)) || null;
    if (!src) continue;
    var score = titleSimilarity(show.name || "", item.title) * 6;
    if (show.premiered && item.year) {
      var year = Number(String(show.premiered).slice(0, 4));
      if (year) score += Math.max(0, 2 - Math.min(2, Math.abs(year - Number(item.year)) / 6));
    }
    if (score > bestScore) {
      bestScore = score;
      best = src;
    }
  }
  return best;
}

function upscaleItunesArtwork(url) {
  if (!url) return null;
  return String(url).replace(/\/[0-9]+x[0-9]+bb\./, "/1200x1200bb.");
}

async function resolveFromITunes(item) {
  var type = normalizeType(item.type);
  var entity = type === "Film" ? "movie" : (type === "TV" ? "tvSeason" : "");
  if (!entity) return null;
  var url =
    "https://itunes.apple.com/search?term=" +
    encodeURIComponent(cleanTitle(item.title)) +
    "&entity=" +
    entity +
    "&limit=12";
  var data = await fetchJson(url, 12000);
  if (!data || !Array.isArray(data.results) || !data.results.length) return null;
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < data.results.length; i++) {
    var r = data.results[i];
    var name = r.trackName || r.collectionName || "";
    var src = upscaleItunesArtwork(r.artworkUrl100 || r.artworkUrl60 || r.artworkUrl30);
    if (!src) continue;
    var score = titleSimilarity(name, item.title) * 6;
    if (r.releaseDate && item.year) {
      var y = Number(String(r.releaseDate).slice(0, 4));
      if (y) score += Math.max(0, 2 - Math.min(2, Math.abs(y - Number(item.year)) / 6));
    }
    if (score > bestScore) {
      bestScore = score;
      best = src;
    }
  }
  return best;
}

async function resolveOne(item) {
  var type = normalizeType(item.type);

  if (type === "Book") {
    var ol = await resolveBookFromOpenLibrary(item);
    if (ol) return { url: ol, source: "openlibrary" };
  }

  if (type === "TV") {
    var tvm = await resolveTVFromTVMaze(item);
    if (tvm) return { url: tvm, source: "tvmaze" };
  }

  var direct = await resolveFromWikiCandidates(item);
  if (direct) return { url: direct.url, source: "wikipedia-summary" };

  var searched = await resolveFromWikiSearch(item);
  if (searched) return { url: searched.url, source: "wikipedia-search" };

  var searchedSummary = await resolveFromWikiSearchSummaries(item);
  if (searchedSummary && searchedSummary.wikibase) {
    var wd2 = await resolveFromWikidata(searchedSummary.wikibase);
    if (wd2) return { url: wd2, source: "wikidata-p18" };
  }
  if (searchedSummary) return { url: searchedSummary.url, source: "wikipedia-search-summary" };

  if (type !== "Book") {
    var it = await resolveFromITunes(item);
    if (it) return { url: it, source: "itunes" };
  }

  if (searchedSummary && searchedSummary.wikibase) {
    var wd3 = await resolveFromWikidata(searchedSummary.wikibase);
    if (wd3) return { url: wd3, source: "wikidata-p18" };
  }

  return null;
}

async function runWithLimit(items, limit, workerFn) {
  var idx = 0;
  var results = new Array(items.length);

  async function worker() {
    while (true) {
      var current = idx++;
      if (current >= items.length) return;
      try {
        results[current] = await workerFn(items[current], current);
      } catch (e) {
        results[current] = null;
      }
    }
  }

  var workers = [];
  for (var i = 0; i < limit; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

function formatOverridesJs(map) {
  return "window.SL_ARTWORK_OVERRIDES = " + JSON.stringify(map, null, 2) + ";\n";
}

async function main() {
  var catalog = loadCatalog();
  var existing = FORCE_REFRESH ? {} : loadExistingOverrides();
  var map = {};
  var sourceById = {};
  var missing = [];

  for (var i = 0; i < catalog.length; i++) {
    var item = catalog[i];
    if (existing[item.id]) {
      map[item.id] = existing[item.id];
      sourceById[item.id] = "existing";
    }
  }

  var unresolved = catalog.filter(function (item) {
    return !map[item.id];
  });

  console.log("Catalog titles:", catalog.length);
  console.log("Mode:", FORCE_REFRESH ? "refresh-all" : "incremental");
  console.log("Existing overrides:", Object.keys(map).length);
  console.log("Resolving remaining:", unresolved.length);

  var resolved = await runWithLimit(unresolved, 2, async function (item, i) {
    var hit = await resolveOne(item);
    var marker = "[" + (i + 1) + "/" + unresolved.length + "]";
    if (hit && hit.url) {
      console.log(marker, "OK", item.id, "via", hit.source);
      return { item: item, hit: hit };
    }
    console.log(marker, "MISS", item.id);
    return { item: item, hit: null };
  });

  for (var r = 0; r < resolved.length; r++) {
    var row = resolved[r];
    if (!row) continue;
    if (row.hit && row.hit.url) {
      map[row.item.id] = row.hit.url;
      sourceById[row.item.id] = row.hit.source || "resolved";
    } else {
      missing.push({
        id: row.item.id,
        title: row.item.title,
        type: row.item.type,
        year: row.item.year
      });
    }
  }

  var orderedMap = {};
  for (var c = 0; c < catalog.length; c++) {
    if (map[catalog[c].id]) orderedMap[catalog[c].id] = map[catalog[c].id];
  }

  fs.writeFileSync(OUT_OVERRIDES_JS, formatOverridesJs(orderedMap), "utf8");

  var report = {
    generatedAt: new Date().toISOString(),
    catalogSize: catalog.length,
    resolvedCount: Object.keys(orderedMap).length,
    missingCount: missing.length,
    sourceById: sourceById,
    missing: missing
  };
  fs.writeFileSync(OUT_REPORT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("Done.");
  console.log("Resolved:", report.resolvedCount);
  console.log("Missing:", report.missingCount);
  console.log("Overrides:", OUT_OVERRIDES_JS);
  console.log("Report:", OUT_REPORT_JSON);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
