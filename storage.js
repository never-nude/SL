window.SL_Storage = (function () {
  var MODE_KEY = "screenlit-mode-v2";
  var PROFILE_KEY = "screenlit-profile-v2";
  var GUEST_KEY = "screenlit-guest-v2";

  var COOLDOWN_MS = {
    no: 1000 * 60 * 60 * 24 * 90,
    unknown: 1000 * 60 * 60 * 24 * 30,
    add: 1000 * 60 * 60 * 24 * 7
  };

  var mem = {
    profile: null,
    guest: null
  };

  function safeLocalStorage() {
    try {
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  function safeSessionStorage() {
    try {
      return sessionStorage;
    } catch (e) {
      return null;
    }
  }

  function blankState() {
    return {
      ratings: {},
      ratingTimes: {},
      dispositions: {},
      dispositionTimes: {}
    };
  }

  function normalize(state) {
    var s = state && typeof state === "object" ? state : blankState();
    s.ratings = s.ratings || {};
    s.ratingTimes = s.ratingTimes || {};
    s.dispositions = s.dispositions || {};
    s.dispositionTimes = s.dispositionTimes || {};
    return s;
  }

  function now() {
    return Date.now();
  }

  function getSessionMode() {
    var ls = safeLocalStorage();
    if (!ls) return "guest";
    var m = ls.getItem(MODE_KEY);
    return m === "profile" ? "profile" : "guest";
  }

  function setSessionMode(mode) {
    var next = mode === "profile" ? "profile" : "guest";
    var ls = safeLocalStorage();
    if (ls) ls.setItem(MODE_KEY, next);
    return next;
  }

  function hasSessionMode() {
    var ls = safeLocalStorage();
    if (!ls) return false;
    return ls.getItem(MODE_KEY) !== null;
  }

  function clearGuestSession() {
    var ss = safeSessionStorage();
    if (ss) ss.removeItem(GUEST_KEY);
    mem.guest = null;
  }

  function driver() {
    if (getSessionMode() === "profile") {
      return { kind: "profile", store: safeLocalStorage(), key: PROFILE_KEY };
    }
    return { kind: "guest", store: safeSessionStorage(), key: GUEST_KEY };
  }

  function load() {
    var d = driver();

    if (!d.store) {
      if (!mem[d.kind]) mem[d.kind] = blankState();
      return normalize(mem[d.kind]);
    }

    try {
      var raw = d.store.getItem(d.key);
      if (!raw) return blankState();
      return normalize(JSON.parse(raw));
    } catch (e) {
      if (!mem[d.kind]) mem[d.kind] = blankState();
      return normalize(mem[d.kind]);
    }
  }

  function save(state) {
    var d = driver();
    var s = normalize(state);

    if (!d.store) {
      mem[d.kind] = s;
      return;
    }

    try {
      d.store.setItem(d.key, JSON.stringify(s));
    } catch (e) {
      mem[d.kind] = s;
    }
  }

  function getRating(id) {
    var s = load();
    return Object.prototype.hasOwnProperty.call(s.ratings, id) ? s.ratings[id] : null;
  }

  function setRating(id, value) {
    var s = load();
    s.ratings[id] = value;
    s.ratingTimes[id] = now();

    if (Object.prototype.hasOwnProperty.call(s.dispositions, id)) {
      delete s.dispositions[id];
      delete s.dispositionTimes[id];
    }

    save(s);
  }

  function getDisposition(id) {
    var s = load();
    return Object.prototype.hasOwnProperty.call(s.dispositions, id) ? s.dispositions[id] : null;
  }

  function setDisposition(id, value) {
    var s = load();
    s.dispositions[id] = value;
    s.dispositionTimes[id] = now();

    // One explicit mark per title: choosing a triad disposition clears any rating.
    if (Object.prototype.hasOwnProperty.call(s.ratings, id)) {
      delete s.ratings[id];
      delete s.ratingTimes[id];
    }

    save(s);
  }

  function getMark(id) {
    return {
      rating: getRating(id),
      disposition: getDisposition(id)
    };
  }

  function getAllRatings() {
    return load().ratings;
  }

  function getAllDispositions() {
    return load().dispositions;
  }

  function mostRecentRating() {
    var s = load();
    var ids = Object.keys(s.ratingTimes);
    if (!ids.length) return null;

    var newestId = ids[0];
    var newestTime = s.ratingTimes[newestId] || 0;

    for (var i = 1; i < ids.length; i++) {
      var id = ids[i];
      var t = s.ratingTimes[id] || 0;
      if (t > newestTime) {
        newestId = id;
        newestTime = t;
      }
    }

    return {
      id: newestId,
      value: s.ratings[newestId],
      time: newestTime
    };
  }

  function isEligible(id) {
    var s = load();

    if (Object.prototype.hasOwnProperty.call(s.ratings, id)) return false;
    if (!Object.prototype.hasOwnProperty.call(s.dispositions, id)) return true;

    var disp = s.dispositions[id];
    var seenAt = s.dispositionTimes[id] || 0;
    var cooldown = COOLDOWN_MS[disp] || COOLDOWN_MS.unknown;
    return now() - seenAt > cooldown;
  }

  function activePoolSet() {
    var pools = window.SL_POOLS;
    if (!pools || !Array.isArray(pools.ACTIVE_POOL) || !pools.ACTIVE_POOL.length) return null;

    var set = {};
    for (var i = 0; i < pools.ACTIVE_POOL.length; i++) {
      set[pools.ACTIVE_POOL[i]] = true;
    }
    return set;
  }

  function eligibleTitles(catalog) {
    var poolSet = activePoolSet();
    var out = [];

    for (var i = 0; i < catalog.length; i++) {
      var item = catalog[i];
      if (poolSet && !poolSet[item.id]) continue;
      if (isEligible(item.id)) out.push(item);
    }

    return out;
  }

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function inferForTitle(item, catalog) {
    var s = load();
    var ratings = s.ratings;
    var ratingIds = Object.keys(ratings);

    if (!ratingIds.length) return 3.0;

    var sum = 0;
    for (var i = 0; i < ratingIds.length; i++) {
      sum += ratings[ratingIds[i]];
    }

    var globalMean = sum / ratingIds.length;

    var recentIds = Object.keys(s.ratingTimes).sort(function (a, b) {
      return (s.ratingTimes[b] || 0) - (s.ratingTimes[a] || 0);
    }).slice(0, 12);

    var recentMean = globalMean;
    if (recentIds.length) {
      var recentSum = 0;
      for (var j = 0; j < recentIds.length; j++) {
        recentSum += ratings[recentIds[j]];
      }
      recentMean = recentSum / recentIds.length;
    }

    var blended = globalMean * 0.75 + recentMean * 0.25;

    var typeById = {};
    for (var k = 0; k < catalog.length; k++) {
      typeById[catalog[k].id] = catalog[k].type;
    }

    var typeVals = [];
    for (var m = 0; m < ratingIds.length; m++) {
      var id = ratingIds[m];
      if (typeById[id] === item.type) typeVals.push(ratings[id]);
    }

    if (!typeVals.length) return clamp(blended, 1, 5);

    var typeSum = 0;
    for (var n = 0; n < typeVals.length; n++) {
      typeSum += typeVals[n];
    }

    var typeMean = typeSum / typeVals.length;
    var typeWeight = Math.min(typeVals.length / 8, 1) * 0.24;

    return clamp((1 - typeWeight) * blended + typeWeight * typeMean, 1, 5);
  }

  if (!hasSessionMode()) setSessionMode("guest");

  return {
    load: load,
    save: save,

    getSessionMode: getSessionMode,
    setSessionMode: setSessionMode,
    hasSessionMode: hasSessionMode,
    clearGuestSession: clearGuestSession,

    getRating: getRating,
    setRating: setRating,
    getDisposition: getDisposition,
    setDisposition: setDisposition,
    getMark: getMark,
    getAllRatings: getAllRatings,
    getAllDispositions: getAllDispositions,

    mostRecentRating: mostRecentRating,
    isEligible: isEligible,
    eligibleTitles: eligibleTitles,
    inferForTitle: inferForTitle
  };
})();
