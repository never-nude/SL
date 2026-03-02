window.SL_Account = (function () {
  var KEY = "screenlit-account-v1";
  var mem = { name: "" };

  function safeLocalStorage() {
    try {
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  function normalizeName(raw) {
    var name = String(raw || "");
    name = name.replace(/\s+/g, " ").trim();
    name = name.replace(/[^\w .'\-]/g, "");
    if (name.length > 32) name = name.slice(0, 32).trim();
    return name;
  }

  function load() {
    var ls = safeLocalStorage();
    if (!ls) return { name: mem.name || "" };

    try {
      var raw = ls.getItem(KEY);
      if (!raw) return { name: "" };
      var parsed = JSON.parse(raw);
      var name = normalizeName(parsed && parsed.name);
      return { name: name };
    } catch (e) {
      return { name: mem.name || "" };
    }
  }

  function save(state) {
    var next = { name: normalizeName(state && state.name) };
    mem.name = next.name;

    var ls = safeLocalStorage();
    if (!ls) return next;

    try {
      ls.setItem(KEY, JSON.stringify(next));
    } catch (e) {}

    return next;
  }

  function getName() {
    return load().name || "";
  }

  function hasName() {
    return !!getName();
  }

  function setName(raw) {
    var name = normalizeName(raw);
    if (!name) return "";
    return save({ name: name }).name;
  }

  function clear() {
    mem.name = "";
    var ls = safeLocalStorage();
    if (!ls) return;
    try {
      ls.removeItem(KEY);
    } catch (e) {}
  }

  function ensureName(defaultName) {
    var current = getName();
    if (current) return current;
    return setName(defaultName || "");
  }

  return {
    getName: getName,
    hasName: hasName,
    setName: setName,
    clear: clear,
    ensureName: ensureName
  };
})();
