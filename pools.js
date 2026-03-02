window.SL_POOLS = (function () {
  var catalog = Array.isArray(window.SL_CATALOG) ? window.SL_CATALOG : [];
  var seen = Object.create(null);
  var active = [];

  for (var i = 0; i < catalog.length; i++) {
    var item = catalog[i];
    if (!item || !item.id || seen[item.id]) continue;
    seen[item.id] = true;
    active.push(item.id);
  }

  return {
    ACTIVE_POOL: active,
    RESERVE_POOL: []
  };
})();
