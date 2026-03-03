(function () {
  var baseCatalog = window.SL_CATALOG || [];
  var audience = window.SL_Audience || null;
  var catalog = baseCatalog;
  var forms = document.querySelectorAll("form[data-sl-search]");

  if (audience && typeof audience.filterCatalog === "function") {
    catalog = audience.filterCatalog(baseCatalog);
  }

  if (!catalog.length || !forms.length) return;

  var byId = {};
  var labelMap = {};
  var rankedCatalog = rankForSuggest(catalog.slice());

  for (var i = 0; i < catalog.length; i++) {
    byId[catalog[i].id] = catalog[i];
  }

  for (var f = 0; f < forms.length; f++) {
    bindForm(forms[f]);
  }

  function bindForm(form) {
    if (!form) return;

    var input = form.querySelector(".searchInput");
    var list = form.querySelector("#slSearchTitles");
    if (!input || !list) return;

    hydrateSuggestions(list);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var raw = String(input.value || "").trim();
      if (!raw) return;

      var direct = labelMap[raw];
      var item = direct || resolveBest(raw);

      if (!item) {
        input.setCustomValidity("No matching title found");
        input.reportValidity();
        window.setTimeout(function () {
          input.setCustomValidity("");
        }, 900);
        return;
      }

      var target = "discover.html?focus=" + encodeURIComponent(item.id) + "&q=" + encodeURIComponent(raw);
      location.href = target;
    });
  }

  function hydrateSuggestions(node) {
    if (!node || node.childNodes.length) return;

    var max = Math.min(1200, rankedCatalog.length);
    for (var i = 0; i < max; i++) {
      var item = rankedCatalog[i];
      var option = document.createElement("option");
      var label = item.title + " (" + item.type + ", " + item.year + ")";
      option.value = label;
      node.appendChild(option);
      labelMap[label] = item;
    }
  }

  function rankForSuggest(items) {
    return items.sort(function (a, b) {
      var am = isMainstream(a) ? 1 : 0;
      var bm = isMainstream(b) ? 1 : 0;
      if (am !== bm) return bm - am;

      var ay = Number(a.year) || 0;
      var by = Number(b.year) || 0;
      if (ay !== by) return by - ay;

      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  function resolveBest(raw) {
    var query = normalize(raw);
    if (!query) return null;

    if (byId[raw]) return byId[raw];

    var year = parseYear(raw);
    var qTokens = query.split(" ");
    var best = null;
    var bestScore = -1;

    for (var i = 0; i < catalog.length; i++) {
      var item = catalog[i];
      var score = scoreTitle(item, query, qTokens, year);
      if (score <= bestScore) continue;
      best = item;
      bestScore = score;
    }

    return bestScore > 18 ? best : null;
  }

  function scoreTitle(item, query, qTokens, year) {
    if (!item) return -1;

    var titleNorm = normalize(item.title);
    if (!titleNorm) return -1;

    var score = 0;

    if (titleNorm === query) {
      score = 120;
    } else if (titleNorm.indexOf(query) === 0) {
      score = 96;
    } else if (titleNorm.indexOf(query) !== -1) {
      score = 80;
    } else {
      var tokenHits = 0;
      for (var i = 0; i < qTokens.length; i++) {
        if (titleNorm.indexOf(qTokens[i]) !== -1) tokenHits += 1;
      }

      if (!tokenHits) return -1;

      var tokenRatio = tokenHits / qTokens.length;
      if (tokenRatio >= 1) score = 70;
      else if (tokenRatio >= 0.7) score = 55;
      else if (tokenRatio >= 0.5) score = 38;
      else return -1;
    }

    if (year && item.year) {
      score -= Math.min(18, Math.abs(Number(item.year) - year));
    }

    if (isMainstream(item)) score += 4;
    if (Number(item.year) >= 2016) score += 1;

    return score;
  }

  function isMainstream(item) {
    if (!item) return false;
    if (item.mainstream === true) return true;
    return /^film_pop_|^tv_pop_|^book_pop_/i.test(item.id || "");
  }

  function parseYear(raw) {
    var m = String(raw || "").match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) : null;
  }

  function normalize(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, "\"")
      .replace(/[–—]/g, "-")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
})();
