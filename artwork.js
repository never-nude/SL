window.SL_Artwork = (function () {
  var CACHE_KEY = "screenlit-artwork-v1";
  var overrides = window.SL_ARTWORK_OVERRIDES || {};
  var memoryCache = Object.create(null);
  var pending = Object.create(null);
  var lightbox = null;
  var lightboxImg = null;
  var lightboxCaption = null;
  var lightboxClose = null;

  loadCache();

  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      memoryCache = parsed;
    } catch (e) {}
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(memoryCache));
    } catch (e) {}
  }

  function normalizeType(t) {
    if (t === "Film" || t === "TV" || t === "Book") return t;
    return "Film";
  }

  function cacheGet(id) {
    if (!Object.prototype.hasOwnProperty.call(memoryCache, id)) return null;
    return memoryCache[id];
  }

  function cacheSet(id, value) {
    memoryCache[id] = value || "";
    saveCache();
  }

  function overrideGet(id) {
    if (!id) return null;
    if (!Object.prototype.hasOwnProperty.call(overrides, id)) return null;
    var v = overrides[id];
    return typeof v === "string" && v ? v : null;
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
    var t = item.title;
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
        t + " (TV series)",
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

  function hasTypeSignal(summary, expectedType) {
    var d = ((summary && summary.description) || "").toLowerCase();
    var title = ((summary && summary.title) || "").toLowerCase();

    if (expectedType === "Film") {
      return d.indexOf("film") !== -1 || title.indexOf("(film)") !== -1;
    }

    if (expectedType === "TV") {
      return (
        d.indexOf("television") !== -1 ||
        d.indexOf("tv series") !== -1 ||
        title.indexOf("(tv") !== -1 ||
        title.indexOf("series") !== -1
      );
    }

    return d.indexOf("novel") !== -1 || d.indexOf("book") !== -1;
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

  async function resolveFromWikipedia(item) {
    var cands = wikiCandidates(item);
    var expectedType = normalizeType(item.type);
    var looseMatch = null;

    for (var i = 0; i < cands.length; i++) {
      var page = cands[i].replace(/ /g, "_");
      var url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(page);
      var summary = await fetchJson(url);
      if (!summary || !summary.thumbnail || !summary.thumbnail.source) continue;

      var thumb = summary.thumbnail.source;
      if (hasTypeSignal(summary, expectedType)) return thumb;
      if (!looseMatch) looseMatch = thumb;
    }

    return looseMatch;
  }

  async function resolveBookFallback(item) {
    if (normalizeType(item.type) !== "Book") return null;

    var url =
      "https://openlibrary.org/search.json?title=" +
      encodeURIComponent(item.title) +
      "&limit=8";

    var data = await fetchJson(url);
    if (!data || !Array.isArray(data.docs) || !data.docs.length) return null;

    var bestDoc = null;
    var bestScore = -1;

    for (var i = 0; i < data.docs.length; i++) {
      var doc = data.docs[i];
      if (!doc || !doc.cover_i) continue;

      var score = 0;
      if (doc.title && doc.title.toLowerCase() === item.title.toLowerCase()) score += 2;

      if (doc.first_publish_year && item.year) {
        var diff = Math.abs(Number(doc.first_publish_year) - Number(item.year));
        score += Math.max(0, 2 - Math.min(2, diff / 10));
      }

      if (score > bestScore) {
        bestScore = score;
        bestDoc = doc;
      }
    }

    if (!bestDoc) return null;
    return "https://covers.openlibrary.org/b/id/" + bestDoc.cover_i + "-M.jpg";
  }

  async function resolve(item) {
    var wiki = await resolveFromWikipedia(item);
    if (wiki) return wiki;

    var fallback = await resolveBookFallback(item);
    if (fallback) return fallback;

    return null;
  }

  function getUrl(item) {
    if (!item || !item.id) return Promise.resolve(null);

    var forced = overrideGet(item.id);
    if (forced) {
      cacheSet(item.id, forced);
      return Promise.resolve(forced);
    }

    var cached = cacheGet(item.id);
    if (cached !== null) return Promise.resolve(cached || null);

    if (pending[item.id]) return pending[item.id];

    var p = resolve(item)
      .then(function (url) {
        cacheSet(item.id, url || "");
        return url || null;
      })
      .catch(function () {
        cacheSet(item.id, "");
        return null;
      })
      .finally(function () {
        delete pending[item.id];
      });

    pending[item.id] = p;
    return p;
  }

  function fallbackLabel(type) {
    if (type === "Book") return "BK";
    if (type === "TV") return "TV";
    return "FM";
  }

  function paintFallback(node, type) {
    node.innerHTML = "";
    var txt = document.createElement("span");
    txt.className = "tilePosterFallback";
    txt.textContent = fallbackLabel(type);
    node.appendChild(txt);
  }

  function clearZoom(node) {
    if (!node) return;
    node.classList.remove("isZoomable");
    node.removeAttribute("role");
    node.removeAttribute("tabindex");
    node.removeAttribute("aria-label");
    node.onclick = null;
    node.onkeydown = null;
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.add("slHidden");
    lightbox.setAttribute("aria-hidden", "true");
    if (lightboxImg) lightboxImg.removeAttribute("src");
  }

  function ensureLightbox() {
    if (lightbox) return;

    lightbox = document.createElement("div");
    lightbox.className = "slLightbox slHidden";
    lightbox.setAttribute("aria-hidden", "true");

    var frame = document.createElement("div");
    frame.className = "slLightboxFrame";
    frame.setAttribute("role", "dialog");
    frame.setAttribute("aria-modal", "true");

    lightboxClose = document.createElement("button");
    lightboxClose.className = "slLightboxClose";
    lightboxClose.type = "button";
    lightboxClose.setAttribute("aria-label", "Close image");
    lightboxClose.textContent = "X";

    lightboxImg = document.createElement("img");
    lightboxImg.className = "slLightboxImg";
    lightboxImg.alt = "";

    lightboxCaption = document.createElement("div");
    lightboxCaption.className = "slLightboxCaption";

    frame.appendChild(lightboxClose);
    frame.appendChild(lightboxImg);
    frame.appendChild(lightboxCaption);
    lightbox.appendChild(frame);

    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) closeLightbox();
    });

    lightboxClose.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeLightbox();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLightbox();
    });

    document.body.appendChild(lightbox);
  }

  function openLightbox(url, item) {
    if (!url || !item) return;
    ensureLightbox();
    if (!lightbox || !lightboxImg || !lightboxCaption) return;

    lightboxImg.src = url;
    lightboxImg.alt = item.title + " artwork";
    lightboxCaption.textContent = item.title + " · " + item.type + " · " + item.year;
    lightbox.classList.remove("slHidden");
    lightbox.setAttribute("aria-hidden", "false");
  }

  function bindZoom(node, item, url) {
    if (!node || !item || !url) return;

    node.classList.add("isZoomable");
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", "Open artwork for " + item.title);

    node.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      openLightbox(url, item);
    };

    node.onkeydown = function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      openLightbox(url, item);
    };
  }

  function mount(node, item) {
    if (!node || !item) return;

    node.classList.add("isLoading");
    clearZoom(node);
    paintFallback(node, item.type);

    getUrl(item).then(function (url) {
      node.classList.remove("isLoading");

      if (!url) {
        clearZoom(node);
        paintFallback(node, item.type);
        return;
      }

      var img = document.createElement("img");
      img.alt = item.title + " cover";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = url;

      img.addEventListener("error", function () {
        clearZoom(node);
        paintFallback(node, item.type);
      });

      node.innerHTML = "";
      node.appendChild(img);
      bindZoom(node, item, url);
    });
  }

  function open(item) {
    if (!item) return;
    getUrl(item).then(function (url) {
      if (!url) return;
      openLightbox(url, item);
    });
  }

  return {
    getUrl: getUrl,
    mount: mount,
    open: open
  };
})();
