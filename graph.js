(function () {
  var edges = Object.create(null);

  function clear() {
    edges = Object.create(null);
  }

  function normalizeRef(ref) {
    if (!ref) return null;
    if (typeof ref === "string") return { id: ref, w: 1 };
    if (ref.id) return { id: ref.id, w: typeof ref.w === "number" ? ref.w : 1 };
    return null;
  }

  function setEdges(map) {
    clear();
    if (!map) return;

    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var refs = map[key] || [];
      var out = [];

      for (var j = 0; j < refs.length; j++) {
        var norm = normalizeRef(refs[j]);
        if (norm) out.push(norm);
      }

      edges[key] = out;
    }
  }

  function getNeighbors(id) {
    return edges[id] || [];
  }

  function loadSeed() {
    var seed = window.SL_GRAPH_SEED;
    if (!seed || !seed.edges) return 0;
    setEdges(seed.edges);
    return Object.keys(seed.edges).length;
  }

  window.SL_Graph = {
    clear: clear,
    setEdges: setEdges,
    getNeighbors: getNeighbors,
    loadSeed: loadSeed
  };

  loadSeed();
})();
