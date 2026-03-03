window.SL_Audience = (function () {
  var KEY = "screenlit-audience-v1";
  var VALID = {
    all: true,
    ya: true,
    kids: true
  };

  function safeLocalStorage() {
    try {
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  function normalizeMode(raw) {
    var mode = String(raw || "").trim().toLowerCase();
    return VALID[mode] ? mode : "all";
  }

  function getMode() {
    var ls = safeLocalStorage();
    if (!ls) return "all";
    return normalizeMode(ls.getItem(KEY));
  }

  function setMode(mode) {
    var next = normalizeMode(mode);
    var ls = safeLocalStorage();
    if (ls) ls.setItem(KEY, next);
    return next;
  }

  function normalizeAudienceTags(raw) {
    if (!raw) return [];

    var arr = Array.isArray(raw) ? raw : [raw];
    var seen = {};
    var out = [];

    for (var i = 0; i < arr.length; i++) {
      var tag = String(arr[i] || "").trim().toLowerCase();
      if (!tag) continue;

      if (tag === "teen") tag = "ya";
      if (tag === "family") tag = "kids";
      if (tag !== "all" && !VALID[tag]) continue;
      if (seen[tag]) continue;

      seen[tag] = true;
      out.push(tag);
    }

    return out;
  }

  function matchesMode(item, mode) {
    var m = normalizeMode(mode);
    if (m === "all") return true;

    var tags = normalizeAudienceTags(item && item.audience);
    for (var i = 0; i < tags.length; i++) {
      if (tags[i] === m || tags[i] === "all") return true;
    }

    return false;
  }

  function filterCatalog(catalog) {
    var mode = getMode();
    if (mode === "all") return (catalog || []).slice();

    var out = [];
    for (var i = 0; i < (catalog || []).length; i++) {
      if (matchesMode(catalog[i], mode)) out.push(catalog[i]);
    }
    return out;
  }

  function setCurrentButtonState(group, mode) {
    var buttons = group.querySelectorAll("[data-audience-mode]");
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var isCurrent = normalizeMode(btn.getAttribute("data-audience-mode")) === mode;
      btn.classList.toggle("isCurrent", isCurrent);
      btn.setAttribute("aria-pressed", isCurrent ? "true" : "false");
    }
  }

  function bindSwitchGroup(group) {
    if (!group || group.__slBound) return;
    group.__slBound = true;

    var mode = getMode();
    setCurrentButtonState(group, mode);

    group.addEventListener("click", function (e) {
      var target = e.target;
      if (!target || !target.getAttribute) return;

      var requested = target.getAttribute("data-audience-mode");
      if (!requested) return;

      e.preventDefault();
      var next = setMode(requested);
      setCurrentButtonState(group, next);

      // Surface scripts read the mode during init; reload keeps behavior deterministic.
      location.reload();
    });
  }

  function bindAllSwitchers() {
    var groups = document.querySelectorAll("[data-sl-audience]");
    for (var i = 0; i < groups.length; i++) {
      bindSwitchGroup(groups[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindAllSwitchers);
  } else {
    bindAllSwitchers();
  }

  return {
    getMode: getMode,
    setMode: setMode,
    filterCatalog: filterCatalog,
    matchesMode: matchesMode
  };
})();
