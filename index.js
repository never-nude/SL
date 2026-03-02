(function () {
  var catalog = window.SL_CATALOG || [];
  var store = window.SL_Storage;
  var ui = window.SL_UI || { fadeMs: 180 };

  if (!store) return;

  var grid = document.getElementById("grid");
  if (!grid) return;

  var slots = new Array(9);
  var slotNodes = new Array(9);
  var sessionSeen = {};

  init();

  function init() {
    var initial = pickInitialNine();
    for (var i = 0; i < 9; i++) {
      slots[i] = initial[i] || null;
    }
    renderInitial();
  }

  function pickInitialNine() {
    var eligible = store.eligibleTitles(catalog);
    return pickManyWeightedByYear(eligible, 9);
  }

  function renderInitial() {
    grid.innerHTML = "";

    for (var i = 0; i < 9; i++) {
      var node = buildTile(slots[i], i);
      slotNodes[i] = node;
      grid.appendChild(node);
    }
  }

  function resolveSlot(slotIndex) {
    var oldNode = slotNodes[slotIndex];
    var oldItem = slots[slotIndex];

    if (oldItem) sessionSeen[oldItem.id] = true;
    if (oldNode) oldNode.classList.add("fadeOut");

    window.setTimeout(function () {
      var next = pickNextForSlot();
      slots[slotIndex] = next;

      var newNode = buildTile(next, slotIndex);
      newNode.classList.add("fadeIn");

      if (oldNode && oldNode.parentNode === grid) {
        grid.replaceChild(newNode, oldNode);
      } else {
        grid.appendChild(newNode);
      }

      slotNodes[slotIndex] = newNode;
    }, ui.fadeMs || 180);
  }

  function pickNextForSlot() {
    var eligible = store.eligibleTitles(catalog);
    if (!eligible.length) return null;

    var visible = {};
    for (var i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].id) visible[slots[i].id] = true;
    }

    var unseen = [];
    var fallback = [];

    for (var j = 0; j < eligible.length; j++) {
      var item = eligible[j];
      if (visible[item.id]) continue;
      fallback.push(item);
      if (!sessionSeen[item.id]) unseen.push(item);
    }

    var pool = unseen.length ? unseen : fallback;
    if (!pool.length) return null;

    return pickOneWeightedByYear(pool);
  }

  function buildTile(item, slotIndex) {
    var tile = document.createElement("div");
    tile.className = "tile";

    if (!item) {
      tile.classList.add("tileEmpty");
      tile.innerHTML = '<div class="tileTitle">No titles</div><div class="tileMeta">All resolved for now</div>';
      return tile;
    }

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
    starsRow.className = "starsRow starsInline";

    var committed = false;

    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var btn = makeStarButton("index", item.id, n);

        btn.addEventListener("mouseenter", function () {
          if (committed) return;
          paintStars(starsRow, n, "preview", true);
        });

        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          if (committed) return;
          committed = true;

          store.setRating(item.id, n);
          paintStars(starsRow, n, "gold", true);
          resolveSlot(slotIndex);
        });

        starsRow.appendChild(btn);
      })(i);
    }

    starsRow.addEventListener("mouseleave", function () {
      if (committed) return;
      paintStars(starsRow, 0, "infer", true);
    });

    paintStars(starsRow, 0, "infer", true);

    var titleRow = document.createElement("div");
    titleRow.className = "titleRow";
    titleRow.appendChild(title);
    titleRow.appendChild(starsRow);

    var facts = document.createElement("div");
    facts.className = "tileFacts";
    mountFacts(facts, item);

    var textWrap = document.createElement("div");
    textWrap.className = "tileText";
    textWrap.appendChild(titleRow);
    textWrap.appendChild(facts);

    head.appendChild(poster);
    head.appendChild(textWrap);

    var triad = makeTriad({
      active: true,
      onNo: function () {
        store.setDisposition(item.id, "no");
        resolveSlot(slotIndex);
      },
      onUnknown: function () {
        store.setDisposition(item.id, "unknown");
        resolveSlot(slotIndex);
      },
      onAdd: function () {
        store.setDisposition(item.id, "add");
        resolveSlot(slotIndex);
      }
    });

    tile.appendChild(head);
    tile.appendChild(triad);

    return tile;
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

    triad.appendChild(makeIcon("−", "No", "no", cfg.active ? cfg.onNo : null, cfg.active));
    triad.appendChild(makeIcon("○", "Don't know", "unknown", cfg.active ? cfg.onUnknown : null, cfg.active));
    triad.appendChild(makeIcon("+", "Add", "add", cfg.active ? cfg.onAdd : null, cfg.active));

    return triad;
  }

  function makeIcon(glyph, label, key, handler, active) {
    var el = document.createElement("div");
    el.className = "icon";
    el.tabIndex = active ? 0 : -1;
    if (key) el.classList.add("icon-" + key);

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
      var fill = integerPaint ? (starIndex <= value ? 1 : 0) : clamp(value - (starIndex - 1), 0, 1);
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

  function cssEscape(id) {
    return id.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, "\\$1");
  }

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function yearWeight(item) {
    var y = Number(item && item.year);
    if (!y) return 1;
    if (y >= 2022) return 3.4;
    if (y >= 2019) return 2.8;
    if (y >= 2016) return 2.2;
    if (y >= 2010) return 1.4;
    return 1;
  }

  function pickOneWeightedByYear(items) {
    if (!items || !items.length) return null;
    var recentPool = [];
    for (var r = 0; r < items.length; r++) {
      if (Number(items[r].year) >= 2016) recentPool.push(items[r]);
    }
    var source = recentPool.length && Math.random() < 0.74 ? recentPool : items;

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

  function pickManyWeightedByYear(items, count) {
    var pool = (items || []).slice();
    var out = [];
    var target = Math.max(0, Number(count) || 0);

    while (out.length < target && pool.length) {
      var chosen = pickOneWeightedByYear(pool);
      if (!chosen) break;
      out.push(chosen);

      for (var i = 0; i < pool.length; i++) {
        if (pool[i] === chosen) {
          pool.splice(i, 1);
          break;
        }
      }
    }

    return out;
  }

  function shuffleInPlace(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
})();
