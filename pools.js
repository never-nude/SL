window.SL_POOLS = (function () {
  var catalog = Array.isArray(window.SL_CATALOG) ? window.SL_CATALOG : [];
  var seen = Object.create(null);
  var byType = {
    Film: [],
    TV: [],
    Book: []
  };

  function isExpandedGenerated(item) {
    if (!item || !item.id) return false;
    return /^film_wd_|^tv_tmz_|^book_ol_/i.test(item.id);
  }

  function isKnown(item) {
    if (!item) return false;
    if (item.mainstream === true) return true;
    return !isExpandedGenerated(item);
  }

  function isAsciiTitle(title) {
    return /^[\x20-\x7E]+$/.test(String(title || ""));
  }

  function isAmericanFamiliar(item) {
    if (!item) return false;
    if (!isExpandedGenerated(item)) return true;
    if (item.american === true) return true;
    if (/^tv_pop_tmz_/i.test(item.id)) return true;
    if (/^film_pop_wd_/i.test(item.id)) return isAsciiTitle(item.title);
    if (/^tv_pop_wd_/i.test(item.id)) return isAsciiTitle(item.title);
    if (/^book_pop_ol_/i.test(item.id)) return isAsciiTitle(item.title);
    return false;
  }

  function yearNum(item) {
    var y = Number(item && item.year);
    return isNaN(y) ? 0 : y;
  }

  function isMadeForTvLike(item) {
    var t = String((item && item.title) || "");
    if (!t) return false;
    return /\b(tv movie|television film|made-for-television)\b/i.test(t);
  }

  function rankFilm(item) {
    var y = yearNum(item);
    var score = 0;
    if (isAmericanFamiliar(item)) score += 10000;
    if (isKnown(item)) score += 4500;
    if (y >= 1960) score += 1800;
    if (y >= 1980) score += 900;
    if (y >= 2000) score += 300;
    score += Math.min(Math.max(y, 1900), 2100);
    return score;
  }

  function rankTV(item) {
    var y = yearNum(item);
    var score = 0;
    if (isAmericanFamiliar(item)) score += 10000;
    if (isKnown(item)) score += 4200;
    if (y >= 1980) score += 2000;
    if (y >= 2000) score += 900;
    if (y >= 2010) score += 300;
    score += Math.min(Math.max(y, 1900), 2100);
    return score;
  }

  function rankBook(item) {
    var y = yearNum(item);
    var score = 0;
    if (isAmericanFamiliar(item)) score += 9000;
    if (isKnown(item)) score += 5200;
    if (y >= 1900) score += 2400;
    if (y >= 1950) score += 1400;
    if (y >= 1980) score += 650;
    if (y >= 2000) score += 300;
    score += Math.min(Math.max(y, 1600), 2100);
    return score;
  }

  function sortByRank(list, rankFn) {
    return list.slice().sort(function (a, b) {
      var diff = rankFn(b) - rankFn(a);
      if (diff !== 0) return diff;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  function pickByPolicy(items, policy) {
    var preferred = [];
    var knownOther = [];
    var other = [];
    var i = 0;

    for (i = 0; i < items.length; i++) {
      var item = items[i];
      if (policy.preferred(item)) preferred.push(item);
      else if (policy.known(item)) knownOther.push(item);
      else other.push(item);
    }

    preferred = sortByRank(preferred, policy.rank);
    knownOther = sortByRank(knownOther, policy.rank);
    other = sortByRank(other, policy.rank);

    var maxByRatio = preferred.length ? Math.floor(preferred.length / policy.ratio) : 0;
    if (maxByRatio < preferred.length) maxByRatio = preferred.length;

    var target = Math.min(items.length, policy.cap, maxByRatio || policy.minTarget || items.length);
    if (policy.minTarget) target = Math.max(Math.min(items.length, policy.minTarget), target);
    if (maxByRatio) target = Math.min(target, maxByRatio);

    var active = [];
    var reserve = [];
    var used = Object.create(null);

    function takeFrom(list) {
      for (var j = 0; j < list.length; j++) {
        var it = list[j];
        if (active.length >= target) break;
        if (used[it.id]) continue;
        used[it.id] = true;
        active.push(it);
      }
    }

    takeFrom(preferred);
    takeFrom(knownOther);
    takeFrom(other);

    function pushRemainder(list) {
      for (var k = 0; k < list.length; k++) {
        var it = list[k];
        if (used[it.id]) continue;
        used[it.id] = true;
        reserve.push(it);
      }
    }

    pushRemainder(preferred);
    pushRemainder(knownOther);
    pushRemainder(other);

    return {
      active: active,
      reserve: reserve,
      target: target,
      preferredCount: preferred.length
    };
  }

  for (var i = 0; i < catalog.length; i++) {
    var item = catalog[i];
    if (!item || !item.id || seen[item.id]) continue;
    seen[item.id] = true;

    if (item.type === "Film" || item.type === "TV" || item.type === "Book") {
      byType[item.type].push(item);
    }
  }

  var filmPolicy = {
    ratio: 0.7,
    cap: 760,
    minTarget: 540,
    known: isKnown,
    rank: rankFilm,
    preferred: function (item) {
      if (!item || item.type !== "Film") return false;
      var y = yearNum(item);
      if (y < 1960) return false;
      if (!isKnown(item)) return false;
      if (isMadeForTvLike(item)) return false;
      return isAmericanFamiliar(item);
    }
  };

  var tvPolicy = {
    ratio: 0.7,
    cap: 810,
    minTarget: 560,
    known: isKnown,
    rank: rankTV,
    preferred: function (item) {
      if (!item || item.type !== "TV") return false;
      var y = yearNum(item);
      if (y < 1980) return false;
      if (!isKnown(item)) return false;
      return isAmericanFamiliar(item);
    }
  };

  var bookPolicy = {
    ratio: 0.85,
    cap: 170,
    minTarget: 130,
    known: isKnown,
    rank: rankBook,
    preferred: function (item) {
      if (!item || item.type !== "Book") return false;
      var y = yearNum(item);
      if (y < 1900) return false;
      if (!isKnown(item)) return false;
      return isAmericanFamiliar(item);
    }
  };

  var filmPick = pickByPolicy(byType.Film, filmPolicy);
  var tvPick = pickByPolicy(byType.TV, tvPolicy);
  var bookPick = pickByPolicy(byType.Book, bookPolicy);

  var activeIds = [];
  var reserveIds = [];

  function pushIds(list, target) {
    for (var j = 0; j < list.length; j++) {
      target.push(list[j].id);
    }
  }

  pushIds(filmPick.active, activeIds);
  pushIds(tvPick.active, activeIds);
  pushIds(bookPick.active, activeIds);

  pushIds(filmPick.reserve, reserveIds);
  pushIds(tvPick.reserve, reserveIds);
  pushIds(bookPick.reserve, reserveIds);

  return {
    ACTIVE_POOL: activeIds,
    RESERVE_POOL: reserveIds
  };
})();
