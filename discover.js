(function () {
  var catalog = window.SL_CATALOG || [];
  var store = window.SL_Storage;
  var graph = window.SL_Graph;
  var audience = window.SL_Audience || null;
  var flags = window.SL_FLAGS || {};
  var ui = window.SL_UI || { fadeMs: 180 };

  if (!store) return;

  var conveyor = document.getElementById("conveyor");
  if (!conveyor) return;

  var byId = {};
  for (var i = 0; i < catalog.length; i++) {
    byId[catalog[i].id] = catalog[i];
  }

  var sessionSeen = {};
  var leftHistory = null; // { item, action: { kind, value } }
  var centerDraft = null; // { itemId, action: { kind, value } } when revising via retreat
  var centerItem = null;
  var rightItem = null;
  var isTransitioning = false;
  var mixStats = { total: 0, mainstream: 0, recent: 0, queue: [] };
  var RECENT_CUTOFF_YEAR = 2016;
  var MIX_WINDOW_SIZE = 60;
  var TARGET_MAINSTREAM = 0.78;
  var TARGET_RECENT = 0.32;
  var MIN_MAINSTREAM = 0.72;
  var MAX_MAINSTREAM = 0.95;
  var MIN_RECENT = 0.22;
  var MAX_RECENT = 0.44;
  var languagePrefCache = null;

  init();

  function init() {
    var focus = resolveFocusItem();

    centerItem = focus || pickNext({
      anchor: null,
      exclude: {}
    });

    rightItem = pickNext({
      anchor: centerItem,
      exclude: centerItem ? objectOf(centerItem.id) : {}
    });

    render();
  }

  function resolveFocusItem() {
    var focusId = null;

    try {
      focusId = new URLSearchParams(location.search).get("focus");
    } catch (e) {
      focusId = null;
    }

    if (!focusId || !byId[focusId]) return null;

    return byId[focusId];
  }

  function render() {
    conveyor.innerHTML = "";

    var leftAction = leftHistory ? leftHistory.action : null;
    var centerAction = null;

    if (centerDraft && centerItem && centerDraft.itemId === centerItem.id) {
      centerAction = centerDraft.action;
    }

    conveyor.appendChild(renderSlot("left", leftHistory ? leftHistory.item : null, {
      action: leftAction,
      isRetreatable: !!leftHistory
    }));

    conveyor.appendChild(renderSlot("center", centerItem, {
      action: centerAction,
      isRetreatable: false
    }));

    conveyor.appendChild(renderSlot("right", rightItem, {
      action: null,
      isRetreatable: false
    }));
  }

  function renderSlot(role, item, slotState) {
    var slot = document.createElement("div");
    slot.className = "slot " + role;

    if (!item) {
      var empty = document.createElement("div");
      empty.className = "tile tileEmpty";

      if (role === "left") {
        empty.innerHTML = '<div class="tileTitle">History</div><div class="tileMeta">Click here to revise your last mark</div>';
      } else {
        empty.innerHTML = '<div class="tileTitle">No title</div><div class="tileMeta">Nothing eligible right now</div>';
      }

      slot.appendChild(empty);
      return slot;
    }

    var tile = document.createElement("div");
    tile.className = "tile tileDiscover";

    var title = document.createElement("div");
    title.className = "tileTitle isZoomableTitle";
    title.textContent = item.title;
    makeTitleZoomable(title, item);

    var head = document.createElement("div");
    head.className = "tileHead";

    var poster = document.createElement("div");
    poster.className = "tilePoster";
    mountArtwork(poster, item);

    var starsRow = document.createElement("div");
    starsRow.className = "starsRow starsInline starsDiscover";

    var inferred = store.inferForTitle(item, catalog);
    var baseline = getStarBaseline(role, inferred, slotState.action);

    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var btn = makeStarButton("discover", item.id, n);

        if (role !== "center") {
          btn.setAttribute("aria-disabled", "true");
          btn.addEventListener("click", function (e) {
            e.stopPropagation();
          });
        } else {
          btn.addEventListener("mouseenter", function () {
            paintStars(starsRow, n, "preview", true);
          });

          btn.addEventListener("click", function (e) {
            e.stopPropagation();
            commitRating(item, n);
          });
        }

        starsRow.appendChild(btn);
      })(i);
    }

    paintStars(starsRow, baseline.value, baseline.mode, baseline.integerPaint);

    if (role === "center") {
      starsRow.addEventListener("mouseleave", function () {
        paintStars(starsRow, baseline.value, baseline.mode, baseline.integerPaint);
      });
    }

    var titleRow = document.createElement("div");
    titleRow.className = "titleRow titleRowDiscover";
    titleRow.appendChild(title);
    titleRow.appendChild(starsRow);

    var facts = document.createElement("div");
    facts.className = "tileFacts tileFactsDiscover";
    mountFacts(facts, item);

    var textWrap = document.createElement("div");
    textWrap.className = "tileText";
    textWrap.appendChild(titleRow);
    textWrap.appendChild(facts);

    head.appendChild(poster);
    head.appendChild(textWrap);

    var selectedDisposition = slotState.action && slotState.action.kind === "disposition"
      ? slotState.action.value
      : null;

    var triad = makeTriad({
      active: role === "center",
      selected: selectedDisposition,
      onNo: function () {
        commitDisposition(item, "no");
      },
      onUnknown: function () {
        commitDisposition(item, "unknown");
      },
      onAdd: function () {
        commitDisposition(item, "add");
      }
    });

    if (role === "left" && slotState.isRetreatable) {
      tile.classList.add("isClickable");
      tile.addEventListener("click", function () {
        retreatToLeft();
      });
    }

    tile.appendChild(head);
    tile.appendChild(triad);

    slot.appendChild(tile);
    return slot;
  }

  function getStarBaseline(role, inferred, action) {
    if (role === "left") {
      if (action && action.kind === "rating") {
        return { value: action.value, mode: "gold", integerPaint: true };
      }
      return { value: 0, mode: "infer", integerPaint: true };
    }

    if (role === "center") {
      if (action && action.kind === "rating") {
        return { value: action.value, mode: "gold", integerPaint: true };
      }
      return { value: inferred, mode: "infer", integerPaint: false };
    }

    return { value: inferred, mode: "infer", integerPaint: false };
  }

  function commitRating(item, value) {
    if (isTransitioning || !item) return;

    store.setRating(item.id, value);
    invalidateLanguagePreferenceCache();

    leftHistory = {
      item: item,
      action: {
        kind: "rating",
        value: value
      }
    };

    advance(item);
  }

  function commitDisposition(item, disposition) {
    if (isTransitioning || !item) return;

    store.setDisposition(item.id, disposition);
    invalidateLanguagePreferenceCache();

    leftHistory = {
      item: item,
      action: {
        kind: "disposition",
        value: disposition
      }
    };

    advance(item);
  }

  function advance(anchorItem) {
    if (centerItem) sessionSeen[centerItem.id] = true;
    if (rightItem) sessionSeen[rightItem.id] = true;

    var nextCenter = rightItem;
    var exclude = {};

    if (leftHistory && leftHistory.item) exclude[leftHistory.item.id] = true;
    if (nextCenter) exclude[nextCenter.id] = true;

    var nextRight = pickNext({
      anchor: anchorItem || nextCenter,
      exclude: exclude
    });

    withConveyorFade(function () {
      centerItem = nextCenter;
      rightItem = nextRight;
      centerDraft = null;
    });
  }

  function retreatToLeft() {
    if (isTransitioning || !leftHistory) return;

    var recalledItem = leftHistory.item;
    var recalledAction = leftHistory.action;
    var previousCenter = centerItem;

    withConveyorFade(function () {
      centerItem = recalledItem;
      centerDraft = {
        itemId: recalledItem.id,
        action: recalledAction
      };
      rightItem = previousCenter;
      leftHistory = null;
    });
  }

  function withConveyorFade(commitFn) {
    isTransitioning = true;
    conveyor.classList.add("isFading");

    window.setTimeout(function () {
      commitFn();
      render();
      conveyor.classList.remove("isFading");
      isTransitioning = false;
    }, ui.fadeMs || 180);
  }

  function pickNext(opts) {
    var anchor = opts && opts.anchor ? opts.anchor : null;
    var exclude = opts && opts.exclude ? opts.exclude : {};

    var eligible = eligibleTitlesForSection();
    if (!eligible.length) return null;

    var unseen = [];
    var fallback = [];

    for (var i = 0; i < eligible.length; i++) {
      var item = eligible[i];
      if (exclude[item.id]) continue;
      fallback.push(item);
      if (!sessionSeen[item.id]) unseen.push(item);
    }

    var basePool = unseen.length ? unseen : fallback;
    var eligiblePool = [];
    for (var p = 0; p < basePool.length; p++) {
      if (!isExpandedCatalogItem(basePool[p]) || isAllowedExpansionItem(basePool[p])) {
        eligiblePool.push(basePool[p]);
      }
    }
    if (eligiblePool.length) basePool = eligiblePool;
    if (!basePool.length) return null;

    var bridged = pickGraphBridge(anchor, basePool);
    if (bridged) return bridged;

    return pickOneWeightedForDiscover(basePool);
  }

  function pickGraphBridge(anchor, basePool) {
    if (!anchor || !anchor.id) return null;
    if (!graph || typeof graph.getNeighbors !== "function") return null;

    var bridgeProb = numberOr(flags.bridgeProb, 0.28);
    if (Math.random() >= bridgeProb) return null;

    var refs = graph.getNeighbors(anchor.id) || [];
    if (!refs.length) return null;

    var poolSet = {};
    for (var i = 0; i < basePool.length; i++) {
      poolSet[basePool[i].id] = basePool[i];
    }

    var weighted = [];
    for (var j = 0; j < refs.length; j++) {
      var ref = refs[j];
      var id = typeof ref === "string" ? ref : ref && ref.id;
      if (!id || !poolSet[id]) continue;

      weighted.push({
        item: poolSet[id],
        w: ref && typeof ref.w === "number" ? ref.w : 1
      });
    }

    if (!weighted.length) return null;

    var cross = [];
    var same = [];

    for (var k = 0; k < weighted.length; k++) {
      var pair = weighted[k];
      if (pair.item.type !== anchor.type) cross.push(pair);
      else same.push(pair);
    }

    var crossBias = numberOr(flags.crossBias, 0.72);
    var lane = null;

    if (cross.length && Math.random() < crossBias) lane = cross;
    else lane = same.length ? same : cross;

    if (!lane || !lane.length) return null;

    var curveballProb = numberOr(flags.curveballProb, 0.1);
    if (Math.random() < curveballProb) {
      var low = lane[0];
      var lowScore = store.inferForTitle(low.item, catalog);

      for (var m = 1; m < lane.length; m++) {
        var score = store.inferForTitle(lane[m].item, catalog);
        if (score < lowScore) {
          low = lane[m];
          lowScore = score;
        }
      }

      noteMixPick(low.item, mixStats);
      return low.item;
    }

    var languagePref = getLanguagePreference();
    var laneItems = [];
    for (var n = 0; n < lane.length; n++) laneItems.push(lane[n].item);
    var chosen = pickOneBalancedForDiscover(laneItems, mixStats, basePool, languagePref);
    if (chosen) {
      noteMixPick(chosen, mixStats);
      return chosen;
    }

    var fallback = pickWeightedItem(lane, languagePref);
    if (fallback) noteMixPick(fallback, mixStats);
    return fallback;
  }

  function pickWeightedItem(weighted, languagePref) {
    var total = 0;
    for (var i = 0; i < weighted.length; i++) {
      total += weighted[i].w * yearWeight(weighted[i].item) * languageWeight(weighted[i].item, languagePref);
    }

    var roll = Math.random() * total;
    for (var j = 0; j < weighted.length; j++) {
      roll -= weighted[j].w * yearWeight(weighted[j].item) * languageWeight(weighted[j].item, languagePref);
      if (roll <= 0) return weighted[j].item;
    }

    return weighted[weighted.length - 1].item;
  }

  function isExpandedCatalogItem(item) {
    if (!item || !item.id) return false;
    return /^film_wd_|^tv_tmz_|^book_ol_/i.test(item.id);
  }

  function splitByCatalogLayer(items) {
    var base = [];
    var expanded = [];

    for (var i = 0; i < items.length; i++) {
      if (isExpandedCatalogItem(items[i])) expanded.push(items[i]);
      else base.push(items[i]);
    }

    return { base: base, expanded: expanded };
  }

  function pickOneWeightedForDiscover(items) {
    if (!items || !items.length) return null;

    var grouped = splitByCatalogLayer(items);
    var expandedSafe = [];
    for (var x = 0; x < grouped.expanded.length; x++) {
      if (isAllowedExpansionItem(grouped.expanded[x])) expandedSafe.push(grouped.expanded[x]);
    }
    var source = items;

    if (expandedSafe.length && grouped.base.length) {
      source = Math.random() < 0.14 ? expandedSafe : grouped.base;
    } else if (expandedSafe.length) {
      source = expandedSafe;
    } else if (grouped.base.length) {
      source = grouped.base;
    }

    var languagePref = getLanguagePreference();
    source = applyLanguagePoolPreference(source, languagePref);
    source = favorAmericanFamiliarPool(source, americanFamiliarProbabilityForUser(0.84, languagePref));

    var chosen = pickOneBalancedForDiscover(source, mixStats, items, languagePref);
    if (chosen) noteMixPick(chosen, mixStats);
    return chosen;
  }

  function isRecentItem(item) {
    return Number(item && item.year) >= RECENT_CUTOFF_YEAR;
  }

  function looksObscureTitle(title) {
    var t = String(title || "").trim();
    if (!t) return true;
    if (/^q\d+$/i.test(t)) return true;
    if (/^(untitled|pilot)$/i.test(t)) return true;
    if (/title card|demo reel|test footage|compilation/i.test(t)) return true;
    return false;
  }

  function isMainstreamItem(item) {
    if (!item) return false;
    if (typeof item.mainstream === "boolean") return item.mainstream;
    if (!isExpandedCatalogItem(item)) return true;
    if (looksObscureTitle(item.title)) return false;

    return false;
  }

  function looksAsciiTitle(title) {
    var t = String(title || "");
    return /^[\x20-\x7E]+$/.test(t);
  }

  function isAmericanFamiliarItem(item) {
    if (!item) return false;
    if (!isExpandedCatalogItem(item)) return true;
    if (item.american === true) return true;
    if (/^tv_pop_tmz_/i.test(item.id)) return true;
    if (/^film_pop_wd_/i.test(item.id)) return looksAsciiTitle(item.title) && Number(item.year) >= 1960;
    if (/^tv_pop_wd_/i.test(item.id)) return looksAsciiTitle(item.title);
    if (/^book_pop_ol_/i.test(item.id)) return looksAsciiTitle(item.title);
    return false;
  }

  function favorAmericanFamiliarPool(source, probability) {
    if (!source || !source.length) return source || [];
    var familiar = [];
    for (var i = 0; i < source.length; i++) {
      if (isAmericanFamiliarItem(source[i])) familiar.push(source[i]);
    }
    if (familiar.length && Math.random() < probability) return familiar;
    return source;
  }

  function invalidateLanguagePreferenceCache() {
    languagePrefCache = null;
  }

  function getLanguagePreference() {
    if (!store || typeof store.load !== "function") return null;

    var state = store.load() || {};
    var ratings = state.ratings || {};
    var dispositions = state.dispositions || {};
    var ratingTimes = state.ratingTimes || {};
    var dispositionTimes = state.dispositionTimes || {};
    var sig = computeLanguagePreferenceSignature(ratings, dispositions, ratingTimes, dispositionTimes);

    if (languagePrefCache && languagePrefCache.sig === sig) {
      return languagePrefCache.pref;
    }

    var pref = buildLanguagePreference(ratings, dispositions);
    languagePrefCache = {
      sig: sig,
      pref: pref
    };

    return pref;
  }

  function computeLanguagePreferenceSignature(ratings, dispositions, ratingTimes, dispositionTimes) {
    var ratingIds = Object.keys(ratings || {});
    var dispositionIds = Object.keys(dispositions || {});
    var ratingSum = 0;
    var dispositionHash = 0;
    var newest = 0;
    var i = 0;

    for (i = 0; i < ratingIds.length; i++) {
      ratingSum += Number(ratings[ratingIds[i]]) || 0;
    }

    for (i = 0; i < dispositionIds.length; i++) {
      var disp = String(dispositions[dispositionIds[i]] || "");
      if (disp === "add") dispositionHash += 7;
      else if (disp === "no") dispositionHash += 11;
      else dispositionHash += 3;
    }

    var ratingTimeIds = Object.keys(ratingTimes || {});
    for (i = 0; i < ratingTimeIds.length; i++) {
      newest = Math.max(newest, Number(ratingTimes[ratingTimeIds[i]]) || 0);
    }

    var dispositionTimeIds = Object.keys(dispositionTimes || {});
    for (i = 0; i < dispositionTimeIds.length; i++) {
      newest = Math.max(newest, Number(dispositionTimes[dispositionTimeIds[i]]) || 0);
    }

    return [
      ratingIds.length,
      dispositionIds.length,
      ratingSum.toFixed(2),
      dispositionHash,
      newest
    ].join("|");
  }

  function buildLanguagePreference(ratings, dispositions) {
    var buckets = {};
    var totalPositive = 0;
    var totalNegative = 0;

    function addSignal(itemId, delta) {
      if (!delta) return;
      var item = byId[itemId];
      if (!item) return;

      var key = getLanguageKeyForItem(item);
      if (!buckets[key]) {
        buckets[key] = {
          key: key,
          pos: 0,
          neg: 0,
          score: 0,
          marks: 0
        };
      }

      var bucket = buckets[key];
      bucket.marks += 1;
      bucket.score += delta;

      if (delta > 0) {
        bucket.pos += delta;
        totalPositive += delta;
      } else {
        var penalty = Math.abs(delta);
        bucket.neg += penalty;
        totalNegative += penalty;
      }
    }

    var ratingIds = Object.keys(ratings || {});
    for (var i = 0; i < ratingIds.length; i++) {
      var rid = ratingIds[i];
      var rating = Number(ratings[rid]);
      if (isNaN(rating)) continue;

      var ratingDelta = (rating - 3) * 1.35;
      if (Math.abs(ratingDelta) < 0.01) continue;
      addSignal(rid, ratingDelta);
    }

    var dispositionIds = Object.keys(dispositions || {});
    for (var j = 0; j < dispositionIds.length; j++) {
      var did = dispositionIds[j];
      var disp = dispositions[did];
      if (disp === "add") addSignal(did, 1.15);
      else if (disp === "no") addSignal(did, -1.15);
    }

    var englishPos = buckets.en ? buckets.en.pos : 0;
    var foreignPos = 0;
    var dominantLanguage = null;
    var dominantPos = 0;
    var bucketKeys = Object.keys(buckets);

    for (var k = 0; k < bucketKeys.length; k++) {
      var key = bucketKeys[k];
      if (!isForeignLanguageKey(key)) continue;

      var pos = buckets[key].pos;
      foreignPos += pos;
      if (pos > dominantPos) {
        dominantPos = pos;
        dominantLanguage = key;
      }
    }

    var signal = totalPositive + totalNegative;
    var hasSignal = signal >= 2.2;
    var foreignShare = totalPositive > 0 ? (foreignPos / totalPositive) : 0;
    var foreignPreferred = hasSignal &&
      foreignPos >= 2.0 &&
      foreignShare >= 0.48 &&
      foreignPos >= englishPos * 0.9;
    var dominantPreferred = !!(foreignPreferred && dominantLanguage && dominantPos >= 1.6 && dominantPos >= foreignPos * 0.32);

    return {
      hasSignal: hasSignal,
      foreignPreferred: foreignPreferred,
      dominantLanguage: dominantPreferred ? dominantLanguage : null,
      dominantPos: dominantPos,
      foreignPos: foreignPos,
      englishPos: englishPos,
      totalPositive: totalPositive
    };
  }

  function getLanguageKeyForItem(item) {
    if (!item) return "en";

    var explicit = normalizeLanguageTag(
      item.lang ||
      item.language ||
      item.originalLanguage ||
      item.original_language
    );
    if (explicit) return explicit;

    return languageFromTitle(item.title);
  }

  function normalizeLanguageTag(raw) {
    if (!raw) return null;
    var key = String(raw).toLowerCase().trim();
    if (!key) return null;

    var first = key.split(/[;,/|]/)[0].trim();
    if (!first) return null;
    if (first.indexOf("-") !== -1) first = first.split("-")[0];
    if (first.indexOf("_") !== -1) first = first.split("_")[0];

    var map = {
      english: "en", eng: "en", en: "en",
      french: "fr", fra: "fr", fre: "fr", fr: "fr",
      spanish: "es", spa: "es", es: "es",
      italian: "it", ita: "it", it: "it",
      german: "de", deu: "de", ger: "de", de: "de",
      portuguese: "pt", por: "pt", pt: "pt",
      russian: "ru", rus: "ru", ru: "ru",
      japanese: "ja", jpn: "ja", ja: "ja",
      korean: "ko", kor: "ko", ko: "ko",
      chinese: "zh", zho: "zh", chi: "zh", zh: "zh",
      hindi: "hi", hin: "hi", hi: "hi",
      arabic: "ar", ara: "ar", ar: "ar",
      hebrew: "he", heb: "he", he: "he",
      greek: "el", ell: "el", gre: "el", el: "el",
      polish: "pl", pol: "pl", pl: "pl",
      turkish: "tr", tur: "tr", tr: "tr",
      dutch: "nl", nld: "nl", dut: "nl", nl: "nl",
      swedish: "sv", swe: "sv", sv: "sv",
      danish: "da", dan: "da", da: "da",
      norwegian: "no", nor: "no", no: "no",
      thai: "th", tha: "th", th: "th",
      vietnamese: "vi", vie: "vi", vi: "vi",
      czech: "cs", ces: "cs", cze: "cs", cs: "cs",
      ukrainian: "uk", ukr: "uk", uk: "uk"
    };

    if (map[first]) return map[first];
    if (/^[a-z]{2}$/.test(first)) return first;
    return null;
  }

  function languageFromTitle(title) {
    var t = String(title || "");
    if (!t) return "en";

    if (/[\uAC00-\uD7AF]/.test(t)) return "ko";
    if (/[\u3040-\u30FF]/.test(t)) return "ja";
    if (/[\u4E00-\u9FFF]/.test(t)) return "zh";
    if (/[\u0400-\u04FF]/.test(t)) return "ru";
    if (/[\u0600-\u06FF]/.test(t)) return "ar";
    if (/[\u0590-\u05FF]/.test(t)) return "he";
    if (/[\u0370-\u03FF]/.test(t)) return "el";
    if (/[\u0900-\u097F]/.test(t)) return "hi";
    if (/[\u0E00-\u0E7F]/.test(t)) return "th";

    if (/^[\x20-\x7E]+$/.test(t)) return "en";

    var latinGuess = inferLatinLanguageFromTitle(t);
    return latinGuess || "intl";
  }

  function inferLatinLanguageFromTitle(title) {
    var lower = String(title || "")
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, "\"")
      .replace(/[–—]/g, "-")
      .replace(/[^a-z\u00C0-\u024F ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!lower) return null;
    if (!/[\u00C0-\u024F]/.test(lower) && !/\b(de|la|le|el|los|las|das|der|und|una|uno)\b/.test(lower)) {
      return null;
    }

    var tokens = lower.split(" ");
    var counts = {
      es: countLanguageTokens(tokens, { de: 1, la: 1, el: 1, los: 1, las: 1, una: 1, uno: 1, y: 1 }),
      fr: countLanguageTokens(tokens, { le: 1, la: 1, les: 1, des: 1, une: 1, du: 1, et: 1, aux: 1 }),
      it: countLanguageTokens(tokens, { il: 1, lo: 1, gli: 1, una: 1, uno: 1, dei: 1, della: 1, e: 1 }),
      de: countLanguageTokens(tokens, { der: 1, die: 1, das: 1, und: 1, ein: 1, eine: 1, dem: 1, den: 1 }),
      pt: countLanguageTokens(tokens, { de: 1, da: 1, do: 1, dos: 1, das: 1, e: 1, uma: 1, o: 1, os: 1, as: 1 })
    };

    var best = null;
    var bestScore = 0;
    var langs = Object.keys(counts);

    for (var i = 0; i < langs.length; i++) {
      var key = langs[i];
      if (counts[key] > bestScore) {
        bestScore = counts[key];
        best = key;
      }
    }

    return bestScore >= 2 ? best : null;
  }

  function countLanguageTokens(tokens, vocab) {
    var n = 0;
    for (var i = 0; i < tokens.length; i++) {
      if (vocab[tokens[i]]) n += 1;
    }
    return n;
  }

  function isForeignLanguageKey(key) {
    return !!key && key !== "en";
  }

  function applyLanguagePoolPreference(source, languagePref) {
    if (!source || !source.length) return source || [];
    if (!languagePref || !languagePref.hasSignal) return source;

    if (languagePref.dominantLanguage && languagePref.dominantLanguage !== "en") {
      var dominant = [];
      for (var i = 0; i < source.length; i++) {
        if (getLanguageKeyForItem(source[i]) === languagePref.dominantLanguage) {
          dominant.push(source[i]);
        }
      }

      if (dominant.length >= 2) {
        var dominantProb = clamp(0.45 + Math.min(0.35, languagePref.dominantPos * 0.08), 0.45, 0.8);
        if (Math.random() < dominantProb) return dominant;
      }
    }

    if (languagePref.foreignPreferred) {
      var foreign = [];
      for (var j = 0; j < source.length; j++) {
        if (isForeignLanguageKey(getLanguageKeyForItem(source[j]))) foreign.push(source[j]);
      }

      if (foreign.length >= 2 && Math.random() < 0.58) return foreign;
    }

    return source;
  }

  function americanFamiliarProbabilityForUser(baseProbability, languagePref) {
    var p = numberOr(baseProbability, 0.84);
    if (!languagePref || !languagePref.hasSignal) return p;

    if (languagePref.foreignPreferred) p *= 0.48;
    if (languagePref.dominantLanguage && languagePref.dominantLanguage !== "en") p *= 0.45;

    return clamp(p, 0.08, 0.96);
  }

  function languageWeight(item, languagePref) {
    if (!item) return 1;
    if (!languagePref || !languagePref.hasSignal) return 1;

    var key = getLanguageKeyForItem(item);
    var w = 1;

    if (languagePref.foreignPreferred) {
      if (isForeignLanguageKey(key)) w *= 1.28;
      else w *= 0.76;
    }

    if (languagePref.dominantLanguage && languagePref.dominantLanguage !== "en") {
      if (key === languagePref.dominantLanguage) w *= 1.9;
      else if (isForeignLanguageKey(key)) w *= 1.08;
      else w *= 0.78;
    }

    return clamp(w, 0.35, 2.75);
  }

  function isAllowedExpansionItem(item) {
    if (!item) return false;
    if (!isExpandedCatalogItem(item)) return true;
    if (item.mainstream !== true) return false;
    if (item.type === "Film" && Number(item.year) && Number(item.year) < 1960) return false;
    return true;
  }

  function pickOneBalancedForDiscover(source, stats, overflowSource, languagePref) {
    var constrained = applyMixConstraints(source, stats);
    var candidates = constrained.length ? constrained : (source || []);

    if (!candidates.length && overflowSource && overflowSource !== source) {
      var overflowConstrained = applyMixConstraints(overflowSource, stats);
      candidates = overflowConstrained.length ? overflowConstrained : overflowSource;
    }

    if (!candidates || !candidates.length) return null;

    var scored = [];
    for (var i = 0; i < candidates.length; i++) {
      var item = candidates[i];
      var simulated = simulateMixAfterPick(stats, item);
      var score = mixScore(simulated.mainRatio, simulated.recentRatio);
      if (isRecentItem(item)) score += 0.03;

      scored.push({
        item: item,
        score: score
      });
    }

    if (!scored.length) return null;

    scored.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return yearWeight(b.item) - yearWeight(a.item);
    });

    var eliteCount = Math.max(8, Math.ceil(scored.length * 0.15));
    if (eliteCount > scored.length) eliteCount = scored.length;
    var elite = scored.slice(0, eliteCount);

    var total = 0;
    var weighted = [];
    for (var j = 0; j < elite.length; j++) {
      var entry = elite[j];
      var w = 1 / (0.08 + Math.max(0, entry.score));
      w *= yearWeight(entry.item);
      w *= languageWeight(entry.item, languagePref);
      weighted.push({ item: entry.item, w: w });
      total += w;
    }

    if (total <= 0) return elite[0].item;

    var roll = Math.random() * total;
    for (var k = 0; k < weighted.length; k++) {
      roll -= weighted[k].w;
      if (roll <= 0) return weighted[k].item;
    }

    return weighted[weighted.length - 1].item;
  }

  function applyMixConstraints(source, stats) {
    if (!source || !source.length) return [];

    var total = stats && stats.total ? stats.total : 0;
    var mainRatio = total ? (stats.mainstream / total) : TARGET_MAINSTREAM;
    var recentRatio = total ? (stats.recent / total) : TARGET_RECENT;

    var needMain = mainRatio < MIN_MAINSTREAM;
    var avoidMain = mainRatio > MAX_MAINSTREAM;
    var needRecent = recentRatio < MIN_RECENT;
    var avoidRecent = recentRatio > MAX_RECENT;

    var strict = filterByConstraint(source, needMain, avoidMain, needRecent, avoidRecent);
    if (strict.length) return strict;

    var mainGap = needMain ? (MIN_MAINSTREAM - mainRatio) : (avoidMain ? (mainRatio - MAX_MAINSTREAM) : 0);
    var recentGap = needRecent ? (MIN_RECENT - recentRatio) : (avoidRecent ? (recentRatio - MAX_RECENT) : 0);

    if ((needMain || avoidMain) && (needRecent || avoidRecent)) {
      if (recentGap >= mainGap) {
        var recentOnly = filterByConstraint(source, false, false, needRecent, avoidRecent);
        if (recentOnly.length) return recentOnly;
      }

      var mainOnly = filterByConstraint(source, needMain, avoidMain, false, false);
      if (mainOnly.length) return mainOnly;
    }

    if (needRecent || avoidRecent) {
      var recents = filterByConstraint(source, false, false, needRecent, avoidRecent);
      if (recents.length) return recents;
    }

    if (needMain || avoidMain) {
      var mains = filterByConstraint(source, needMain, avoidMain, false, false);
      if (mains.length) return mains;
    }

    return source;
  }

  function filterByConstraint(source, needMain, avoidMain, needRecent, avoidRecent) {
    var out = [];

    for (var i = 0; i < source.length; i++) {
      var item = source[i];
      var isMain = isMainstreamItem(item);
      var isRecent = isRecentItem(item);

      if (needMain && !isMain) continue;
      if (avoidMain && isMain) continue;
      if (needRecent && !isRecent) continue;
      if (avoidRecent && isRecent) continue;

      out.push(item);
    }

    return out;
  }

  function simulateMixAfterPick(stats, item) {
    var total = (stats && stats.total ? stats.total : 0) + 1;
    var mainstream = (stats && stats.mainstream ? stats.mainstream : 0) + (isMainstreamItem(item) ? 1 : 0);
    var recent = (stats && stats.recent ? stats.recent : 0) + (isRecentItem(item) ? 1 : 0);

    return {
      mainRatio: mainstream / total,
      recentRatio: recent / total
    };
  }

  function mixScore(mainRatio, recentRatio) {
    var score = Math.abs(mainRatio - TARGET_MAINSTREAM) + Math.abs(recentRatio - TARGET_RECENT);
    score += bandPenalty(mainRatio, MIN_MAINSTREAM, MAX_MAINSTREAM);
    score += bandPenalty(recentRatio, MIN_RECENT, MAX_RECENT);
    return score;
  }

  function bandPenalty(ratio, min, max) {
    if (ratio < min) return (min - ratio) * 4;
    if (ratio > max) return (ratio - max) * 4;
    return 0;
  }

  function noteMixPick(item, stats) {
    if (!item || !stats) return;
    var entry = {
      main: isMainstreamItem(item),
      recent: isRecentItem(item)
    };

    if (!stats.queue) stats.queue = [];
    stats.queue.push(entry);

    stats.total += 1;
    if (entry.main) stats.mainstream += 1;
    if (entry.recent) stats.recent += 1;

    if (stats.queue.length > MIX_WINDOW_SIZE) {
      var removed = stats.queue.shift();
      stats.total -= 1;
      if (removed.main) stats.mainstream -= 1;
      if (removed.recent) stats.recent -= 1;
    }

    if (stats.total < 0) {
      stats.total = 0;
      stats.mainstream = 0;
      stats.recent = 0;
      stats.queue = [];
    }
  }

  function yearWeight(item) {
    var y = Number(item && item.year);
    if (!y) return 1;
    var w = 1;
    if (y >= 2022) w = 0.85;
    else if (y >= 2019) w = 0.92;
    else if (y >= 2016) w = 1;
    else if (y >= 2010) w = 1.2;
    else if (y >= 2000) w = 1.35;
    else if (y >= 1990) w = 1.5;
    else if (y >= 1980) w = 1.45;
    else w = 1.3;

    if (item && item.type === "Film") {
      if (y < 1960) w *= 0.35;
      else w *= 1.22;
    }

    return w;
  }

  function pickOneWeightedByYear(items) {
    if (!items || !items.length) return null;
    var legacyPool = [];
    for (var r = 0; r < items.length; r++) {
      if (Number(items[r].year) < RECENT_CUTOFF_YEAR) legacyPool.push(items[r]);
    }
    var source = legacyPool.length && Math.random() < 0.72 ? legacyPool : items;

    var total = 0;

    for (var i = 0; i < source.length; i++) {
      total += yearWeight(source[i]);
    }

    var roll = Math.random() * total;
    for (var j = 0; j < source.length; j++) {
      roll -= yearWeight(source[j]);
      if (roll <= 0) return source[j];
    }

    return source[source.length - 1];
  }

  function numberOr(value, fallback) {
    return typeof value === "number" && !isNaN(value) ? value : fallback;
  }

  function mountArtwork(node, item) {
    if (window.SL_Artwork && typeof window.SL_Artwork.mount === "function") {
      window.SL_Artwork.mount(node, item);
      return;
    }

    var fallback = document.createElement("span");
    fallback.className = "tilePosterFallback";
    fallback.textContent = item.type === "Book" ? "BK" : (item.type === "TV" ? "TV" : "FM");
    node.innerHTML = "";
    node.appendChild(fallback);
  }

  function mountFacts(node, item) {
    if (window.SL_Facts && typeof window.SL_Facts.mount === "function") {
      window.SL_Facts.mount(node, item);
      return;
    }

    node.innerHTML = "";
    var fallback = document.createElement("div");
    fallback.className = "tileMetaLine";
    fallback.textContent = item.type + " \u00B7 " + item.year;
    node.appendChild(fallback);
  }

  function openArtwork(item) {
    if (!window.SL_Artwork || typeof window.SL_Artwork.open !== "function") return;
    window.SL_Artwork.open(item);
  }

  function makeTitleZoomable(node, item) {
    if (!node || !item) return;

    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", "Open artwork for " + item.title);

    node.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openArtwork(item);
    });

    node.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      openArtwork(item);
    });
  }

  function makeTriad(cfg) {
    var triad = document.createElement("div");
    triad.className = "triad";

    triad.appendChild(makeIcon("−", "No", "no", cfg.active ? cfg.onNo : null, cfg.active, cfg.selected));
    triad.appendChild(makeIcon("○", "Don't know", "unknown", cfg.active ? cfg.onUnknown : null, cfg.active, cfg.selected));
    triad.appendChild(makeIcon("+", "Add", "add", cfg.active ? cfg.onAdd : null, cfg.active, cfg.selected));

    return triad;
  }

  function makeIcon(glyph, label, key, handler, active, selectedKey) {
    var el = document.createElement("div");
    el.className = "icon";
    el.tabIndex = active ? 0 : -1;
    if (key) el.classList.add("icon-" + key);

    if (selectedKey === key) {
      el.classList.add("isSelected");
    }

    var text = document.createElement("span");
    text.className = "iconGlyph";
    text.textContent = glyph;

    var labelNode = document.createElement("span");
    labelNode.className = "iconLabel";
    labelNode.textContent = label;

    el.appendChild(text);
    el.appendChild(labelNode);

    if (!active || typeof handler !== "function") {
      el.setAttribute("aria-disabled", "true");
      el.addEventListener("click", function (e) {
        e.stopPropagation();
      });
      return el;
    }

    el.addEventListener("click", function (e) {
      e.stopPropagation();
      handler();
    });

    el.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      handler();
    });

    return el;
  }

  function makeStarButton(scope, id, n) {
    var btn = document.createElement("button");
    btn.className = "starBtn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Star " + n);

    var clipId = ["clip", scope, id, n, Math.floor(Math.random() * 1e9)].join("_");

    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
        '<defs><clipPath id="' + clipId + '"><rect x="0" y="0" width="0" height="24"></rect></clipPath></defs>' +
        '<path class="starFillInfer" clip-path="url(#' + clipId + ')" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path>' +
        '<path class="starOutline" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path>' +
      '</svg>';

    btn.dataset.clipId = clipId;
    return btn;
  }

  function paintStars(starsRow, value, mode, integerPaint) {
    var buttons = starsRow.querySelectorAll(".starBtn");

    for (var i = 0; i < buttons.length; i++) {
      var starIndex = i + 1;
      var fill = integerPaint
        ? (starIndex <= value ? 1 : 0)
        : clamp(value - (starIndex - 1), 0, 1);

      setStarFill(buttons[i], fill, mode);
    }
  }

  function setStarFill(btn, frac0to1, mode) {
    var clipId = btn.dataset.clipId;
    if (!clipId) return;

    var rect = btn.querySelector("#" + cssEscape(clipId) + " rect");
    if (!rect) return;

    rect.setAttribute("width", String(clamp(frac0to1, 0, 1) * 24));

    var fillNode = btn.querySelector("path.starFillInfer, path.starFillPreview, path.starFillGold");
    if (!fillNode) return;

    if (mode === "gold") {
      fillNode.className.baseVal = "starFillGold";
    } else if (mode === "preview") {
      fillNode.className.baseVal = "starFillPreview";
    } else {
      fillNode.className.baseVal = "starFillInfer";
    }
  }

  function objectOf(id) {
    var out = {};
    out[id] = true;
    return out;
  }

  function cssEscape(id) {
    return id.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, "\\$1");
  }

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function eligibleTitlesForSection() {
    var source = catalog;

    if (audience && typeof audience.filterCatalog === "function") {
      source = audience.filterCatalog(catalog);
    }

    return store.eligibleTitles(source);
  }
})();
