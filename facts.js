window.SL_Facts = (function () {
  var CACHE_KEY = "screenlit-facts-v4";
  var cache = Object.create(null);
  var pending = Object.create(null);

  loadCache();

  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") cache = parsed;
    } catch (e) {}
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }

  function normalizeLookupTitle(raw) {
    return String(raw || "")
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, "\"")
      .replace(/[–—]/g, "-")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanTitle(title) {
    return normalizeLookupTitle(title)
      .replace(/\s+\((film|book|tv)\)$/i, "")
      .replace(/\s+\((?!\d{4}\b)[^)]+\)$/i, "")
      .trim();
  }

  function normalizeType(t) {
    return t === "Film" || t === "TV" || t === "Book" ? t : "Film";
  }

  function dedupe(arr) {
    var out = [];
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
      var s = (arr[i] || "").trim();
      if (!s || seen[s]) continue;
      seen[s] = true;
      out.push(s);
    }
    return out;
  }

  function wikiCandidates(item) {
    var t = cleanTitle(item.title);
    var y = item.year;
    var type = normalizeType(item.type);

    if (type === "Film") {
      return dedupe([
        t + " (" + y + " film)",
        t + " (film)",
        t
      ]);
    }

    if (type === "TV") {
      return dedupe([
        t + " (" + y + " TV series)",
        t + " (" + y + " television series)",
        t + " (" + y + " American TV series)",
        t + " (TV series)",
        t + " (television series)",
        t + " (American TV series)",
        t
      ]);
    }

    return dedupe([
      t + " (" + y + " novel)",
      t + " (novel)",
      t + " (book)",
      t
    ]);
  }

  async function fetchJson(url) {
    try {
      var res = await fetch(url, { method: "GET", mode: "cors" });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  function hasTypeSignal(summary, expectedType) {
    var d = ((summary && summary.description) || "").toLowerCase();

    if (expectedType === "Film") return d.indexOf("film") !== -1;
    if (expectedType === "TV") {
      return d.indexOf("television") !== -1 || d.indexOf("tv") !== -1 || d.indexOf("series") !== -1 || d.indexOf("miniseries") !== -1;
    }
    return d.indexOf("novel") !== -1 || d.indexOf("book") !== -1;
  }

  async function resolveViaSearch(item) {
    var type = normalizeType(item.type);
    var t = cleanTitle(item.title);
    var y = item.year;
    var typeHint = type === "Film" ? "film" : (type === "TV" ? "TV series" : "novel");
    var query = t + " " + y + " " + typeHint;
    var url =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=6&origin=*&srsearch=" +
      encodeURIComponent(query);

    var search = await fetchJson(url);
    var hits = (search && search.query && search.query.search) ? search.query.search : [];
    var loose = null;

    for (var i = 0; i < hits.length; i++) {
      var hit = hits[i];
      if (!hit || !hit.title) continue;

      var page = String(hit.title).replace(/ /g, "_");
      var summaryUrl = "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(page);
      var summary = await fetchJson(summaryUrl);
      if (!summary || !summary.title) continue;

      if (hasTypeSignal(summary, type)) return summary;
      if (!loose) loose = summary;
    }

    return loose;
  }

  async function resolveSummary(item) {
    var cands = wikiCandidates(item);
    var type = normalizeType(item.type);
    var loose = null;

    for (var i = 0; i < cands.length; i++) {
      var page = cands[i].replace(/ /g, "_");
      var url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(page);
      var j = await fetchJson(url);
      if (!j || !j.title) continue;

      if (hasTypeSignal(j, type)) return j;
      if (!loose) loose = j;
    }

    var searched = await resolveViaSearch(item);
    return searched || loose;
  }

  async function fetchWikitext(canonical) {
    if (!canonical) return null;

    var url =
      "https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&origin=*&page=" +
      encodeURIComponent(canonical);

    var j = await fetchJson(url);
    if (!j || !j.parse || !j.parse.wikitext || !j.parse.wikitext["*"]) return null;
    return j.parse.wikitext["*"];
  }

  function stripTemplates(value) {
    var out = value;
    var prev = null;

    // Best-effort template stripping for infobox field values.
    for (var i = 0; i < 8; i++) {
      prev = out;
      out = out.replace(/\{\{[^{}]*\}\}/g, " ");
      if (out === prev) break;
    }

    return out;
  }

  function cleanValue(value) {
    if (!value) return "";

    var out = String(value);
    out = out.replace(/<!--[^]*?-->/g, " ");
    out = out.replace(/<ref[^>]*\/\s*>/gi, " ");
    out = out.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ");
    out = out.replace(/<br\s*\/?>/gi, " · ");
    out = out.replace(/<[^>]+>/g, " ");
    out = stripTemplates(out);

    out = out.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1");
    out = out.replace(/\[\[([^\]]+)\]\]/g, "$1");
    out = out.replace(/\[[^\] ]+ ([^\]]+)\]/g, "$1");

    out = out.replace(/''+/g, "");
    out = out.replace(/&nbsp;/gi, " ");
    out = out.replace(/\s*\(\s*first edition\s*\)/gi, "");
    out = out.replace(/\s+/g, " ");
    out = out.replace(/\s*·\s*/g, " · ");

    return out.trim();
  }

  function extractField(wikitext, keys) {
    if (!wikitext) return "";

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i].replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      var rx = new RegExp("\\|\\s*" + key + "\\s*=([\\s\\S]*?)(?=\\n\\|\\s*[^=\\n]+\\s*=|\\n\\}\\})", "i");
      var m = wikitext.match(rx);
      if (!m || !m[1]) continue;
      var cleaned = cleanValue(m[1]);
      if (cleaned) return cleaned;
    }

    return "";
  }

  function runtimeCompact(v) {
    if (!v) return "";
    var m = v.match(/(\d+\s*[–-]\s*\d+)\s*minutes?/i);
    if (m) return m[1].replace(/\s+/g, "") + " min";
    m = v.match(/(\d+)\s*minutes?/i);
    if (m) return m[1] + " min";
    return v;
  }

  function sanitizeFactValue(v, maxLen) {
    if (!v) return "";

    var out = String(v)
      .replace(/\s*\|\s*/g, " · ")
      .replace(/\s*\*\s*/g, " · ")
      .replace(/\s+/g, " ")
      .replace(/( · ){2,}/g, " · ")
      .replace(/^ · | · $/g, "")
      .trim();

    // Drop parser spillover values like "field = value field2 = value2".
    if (/\b[a-z][a-z0-9_ ]{1,28}\s*=\s*/i.test(out)) return "";

    if (maxLen && out.length > maxLen) {
      out = out.slice(0, maxLen - 1).trim() + "\u2026";
    }

    return out;
  }

  function pagesCompact(v) {
    if (!v) return "";
    var m = v.match(/(\d{2,5})/);
    return m ? (m[1] + " pages") : v;
  }

  function seasonsCompact(v) {
    if (!v) return "";
    var m = v.match(/(\d{1,3})/);
    return m ? m[1] : "";
  }

  function episodesCompact(v) {
    if (!v) return "";
    var m = v.match(/(\d{1,4})/);
    return m ? m[1] : "";
  }

  function extractCreatorFromSummary(summary, item) {
    var text = ((summary && summary.extract) || "") + " " + ((summary && summary.description) || "");

    if (item.type === "Film") {
      var mFilm = text.match(/directed by ([A-Z][A-Za-z .'-]+)/i);
      if (mFilm) return mFilm[1].trim();
    }

    if (item.type === "TV") {
      var mTv = text.match(/created by ([A-Z][A-Za-z .'-]+)/i);
      if (mTv) return mTv[1].trim();
    }

    if (item.type === "Book") {
      var mBook = text.match(/novel by ([A-Z][A-Za-z .'-]+)/i) || text.match(/book by ([A-Z][A-Za-z .'-]+)/i);
      if (mBook) return mBook[1].trim();
    }

    return "";
  }

  function makeBaseFacts(item) {
    return {
      type: item.type,
      year: item.year,
      creatorLabel: item.type === "Book" ? "Author" : (item.type === "TV" ? "Creator" : "Director"),
      creator: "",
      lengthLabel: item.type === "Book" ? "Pages" : "Runtime",
      length: "",
      scopeLabel: "",
      scope: ""
    };
  }

  function applyWikitextFacts(facts, item, wikitext) {
    if (!wikitext) return facts;

    if (item.type === "Film") {
      var director = extractField(wikitext, ["director", "directed_by"]);
      var runtime = extractField(wikitext, ["runtime", "running_time", "running time"]);

      if (director) facts.creator = sanitizeFactValue(director, 72);
      if (runtime) facts.length = sanitizeFactValue(runtimeCompact(runtime), 24);
      return facts;
    }

    if (item.type === "TV") {
      var creator = extractField(wikitext, ["creator", "developed_by", "showrunner", "developer", "writer", "written_by"]);
      var runtimeTv = extractField(wikitext, ["runtime", "running_time", "running time"]);
      var seasons = seasonsCompact(extractField(wikitext, ["num_seasons", "number_of_seasons", "no_of_seasons"]));
      var episodes = episodesCompact(extractField(wikitext, ["num_episodes", "number_of_episodes", "no_of_episodes"]));

      if (creator) facts.creator = sanitizeFactValue(creator, 72);
      if (runtimeTv) facts.length = sanitizeFactValue(runtimeCompact(runtimeTv), 24);

      if (seasons || episodes) {
        facts.scopeLabel = "Series";
        facts.scope = sanitizeFactValue(
          (seasons ? (seasons + " seasons") : "") + (seasons && episodes ? " · " : "") + (episodes ? (episodes + " eps") : ""),
          32
        );
      }
      return facts;
    }

    var author = extractField(wikitext, ["author", "authors", "writer"]);
    var pages = extractField(wikitext, ["pages", "page_count", "number_of_pages"]);
    var series = extractField(wikitext, ["series"]);

    if (author) facts.creator = sanitizeFactValue(author, 72);
    if (pages) facts.length = sanitizeFactValue(pagesCompact(pages), 24);

    if (series) {
      facts.scopeLabel = "Series";
      facts.scope = sanitizeFactValue(series, 48);
    }

    return facts;
  }

  async function resolve(item) {
    var facts = makeBaseFacts(item);
    var summary = await resolveSummary(item);

    var canonical = "";
    if (summary && summary.titles && summary.titles.canonical) canonical = summary.titles.canonical;
    if (!canonical && summary && summary.title) canonical = String(summary.title).replace(/ /g, "_");

    var wikitext = await fetchWikitext(canonical);
    facts = applyWikitextFacts(facts, item, wikitext);

    if (!facts.creator) {
      facts.creator = sanitizeFactValue(extractCreatorFromSummary(summary, item), 72);
    }

    return facts;
  }

  function get(item) {
    if (!item || !item.id) return Promise.resolve(null);

    if (Object.prototype.hasOwnProperty.call(cache, item.id)) {
      return Promise.resolve(cache[item.id] || null);
    }

    if (pending[item.id]) return pending[item.id];

    var p = resolve(item)
      .then(function (facts) {
        cache[item.id] = facts || null;
        saveCache();
        return facts || null;
      })
      .catch(function () {
        cache[item.id] = null;
        saveCache();
        return null;
      })
      .finally(function () {
        delete pending[item.id];
      });

    pending[item.id] = p;
    return p;
  }

  function addLine(node, text) {
    if (!text) return;
    var line = document.createElement("div");
    line.className = "tileMetaLine";
    line.textContent = text;
    node.appendChild(line);
  }

  function render(node, item, facts) {
    if (!node || !item) return;

    node.innerHTML = "";
    addLine(node, item.type + " · " + item.year);

    var view = facts || makeBaseFacts(item);
    addLine(node, view.creatorLabel + ": " + (view.creator || "—"));
    addLine(node, view.lengthLabel + ": " + (view.length || "—"));

    if (item.type === "TV") {
      addLine(node, (view.scopeLabel || "Series") + ": " + (view.scope || "—"));
    } else if (view.scopeLabel && view.scope) {
      addLine(node, view.scopeLabel + ": " + view.scope);
    }
  }

  function mount(node, item) {
    if (!node || !item) return;

    render(node, item, null);

    get(item).then(function (facts) {
      render(node, item, facts);
    });
  }

  return {
    get: get,
    mount: mount
  };
})();
