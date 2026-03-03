// EDU Region Card (desktop route) — minimal, recoverable, deterministic.
// Watches the existing "Selected:" text and shows a 2–3 sentence explainer.
// Does NOT modify the core renderer.

(() => {
  const EDU_BUILD = new Date().toISOString();

  // Basic desktop-only guard (still shows a tiny message if opened on mobile)
  const isProbablyMobile =
    window.matchMedia("(max-width: 900px)").matches ||
    window.matchMedia("(pointer: coarse)").matches;

  // Candidate sources for "Selected:" (user reported it's in the top-left build box)
  const sourceEls = [
    document.getElementById("build"),
    document.getElementById("hud"),
    document.getElementById("overlay"),
    document.getElementById("info"),
  ].filter(Boolean);

  // Panel UI
  const panel = document.createElement("div");
  panel.id = "edu-panel";
  panel.innerHTML = `
    <div class="edu-title">
      <div>Region Explainer <span class="edu-pill">EDU</span></div>
      <div class="edu-mini" id="edu-mode"></div>
    </div>

    <div class="edu-selected" id="edu-selected">Selected: (none)</div>
    <div class="edu-card">
      <div class="edu-card-title" id="edu-title">(click a node)</div>
      <div class="edu-card-summary" id="edu-summary">When you click a region node, this panel will show a short, college-level anatomy/physiology summary of what that region is commonly involved in.</div>
      <div class="edu-card-meta" id="edu-meta"></div>
    </div>

    <div class="edu-foot">
      <div class="edu-mini" id="edu-source">Watching: (pending)</div>
      <div class="edu-mini">Educational summary (simplified)</div>
    </div>
  `;
  document.body.appendChild(panel);

  const style = document.createElement("style");
  style.textContent = `
    #edu-panel{
      position:fixed;
      right:12px;
      bottom:12px;
      z-index:9999;
      width:min(420px, calc(100vw - 24px));
      max-height:60vh;
      overflow:auto;
      background:rgba(0,0,0,0.60);
      border:1px solid rgba(255,255,255,0.14);
      border-radius:12px;
      padding:10px 10px 8px;
      backdrop-filter: blur(8px);
      color: rgba(255,255,255,0.92);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    #edu-panel .edu-title{
      display:flex;
      justify-content:space-between;
      align-items:baseline;
      gap:10px;
      font-weight:650;
      margin-bottom:8px;
    }
    #edu-panel .edu-pill{
      display:inline-block;
      margin-left:6px;
      padding:2px 8px;
      border-radius:999px;
      border:1px solid rgba(255,255,255,0.18);
      background: rgba(0,0,0,0.25);
      font-size:12px;
      font-weight:600;
      opacity:0.95;
    }
    #edu-panel .edu-selected{
      font-size:13px;
      opacity:0.95;
      margin-bottom:8px;
      white-space:pre-wrap;
    }
    #edu-panel .edu-card{
      border:1px solid rgba(255,255,255,0.12);
      background: rgba(0,0,0,0.25);
      border-radius:10px;
      padding:10px;
    }
    #edu-panel .edu-card-title{
      font-weight:650;
      margin-bottom:6px;
    }
    #edu-panel .edu-card-summary{
      font-size:14px;
      line-height:1.35;
      opacity:0.96;
    }
    #edu-panel .edu-card-meta{
      margin-top:8px;
      font-size:12px;
      opacity:0.85;
    }
    #edu-panel .edu-foot{
      margin-top:8px;
      display:flex;
      justify-content:space-between;
      gap:10px;
      flex-wrap:wrap;
    }
    #edu-panel .edu-mini{
      font-size:12px;
      opacity:0.85;
    }
  `;
  document.head.appendChild(style);

  const elSelected = panel.querySelector("#edu-selected");
  const elTitle = panel.querySelector("#edu-title");
  const elSummary = panel.querySelector("#edu-summary");
  const elMeta = panel.querySelector("#edu-meta");
  const elSource = panel.querySelector("#edu-source");
  const elMode = panel.querySelector("#edu-mode");

  elMode.textContent = isProbablyMobile ? "disabled on mobile" : "";

  function normalize(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[\u2019]/g, "'")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function extractSelected(rawText) {
    if (!rawText) return null;

    // Common formats:
    // "Selected: Heschl_L"
    // "Selected: Heschl's gyrus (Left)"
    // "selected = ..."
    const m1 = rawText.match(/(?:^|\n)\s*Selected\s*:\s*([^\n]+)/i);
    if (m1) return m1[1].trim();

    const m2 = rawText.match(/(?:^|\n)\s*selected\s*=\s*([^\n]+)/i);
    if (m2) return m2[1].trim();

    return null;
  }

  function extractAalKey(s) {
    if (!s) return null;
    const m = s.match(/\b[A-Za-z]+(?:_[A-Za-z0-9]+)*_[LR]\b/);
    return m ? m[0] : null;
  }

  let cards = null;
  let aliasIndex = {};
  let last = "";

  function rebuildAliasIndex() {
    aliasIndex = {};
    if (!cards) return;
    for (const [k, c] of Object.entries(cards)) {
      aliasIndex[normalize(k)] = k;
      if (c?.title) aliasIndex[normalize(c.title)] = k;
      if (Array.isArray(c?.aliases)) {
        for (const a of c.aliases) aliasIndex[normalize(a)] = k;
      }
    }
  }

  function findCard(selectedText) {
    if (!cards) return null;

    const aalKey = extractAalKey(selectedText);
    if (aalKey && cards[aalKey]) return { key: aalKey, card: cards[aalKey], via: "aalKey" };

    const norm = normalize(selectedText);
    const key2 = aliasIndex[norm];
    if (key2 && cards[key2]) return { key: key2, card: cards[key2], via: "alias" };

    // Small fuzzy fallback: contains-title match
    for (const [k, c] of Object.entries(cards)) {
      const t = normalize(c?.title || "");
      if (t && (norm.includes(t) || t.includes(norm))) {
        return { key: k, card: c, via: "fuzzy" };
      }
    }

    return null;
  }

  function renderNone(selectedText) {
    elTitle.textContent = selectedText ? selectedText : "(click a node)";
    elSummary.textContent = selectedText
      ? `No explainer card yet for "${selectedText}".`
      : "When you click a region node, this panel will show a short, college-level anatomy/physiology summary.";
    elMeta.textContent = "File: /model/edu/aal_region_cards.json";
  }

  function renderCard(selectedText, found) {
    const { key, card, via } = found;
    elTitle.textContent = card.title || selectedText || key;
    elSummary.textContent = card.summary || "";
    const nets = Array.isArray(card.networks) ? card.networks.join(", ") : "";
    elMeta.textContent = `Key: ${key}  • via: ${via}` + (nets ? `  • networks: ${nets}` : "");
  }

  function updateFromSources() {
    for (const el of sourceEls) {
      const sel = extractSelected(el.textContent || "");
      if (sel && sel !== last) {
        last = sel;
        elSelected.textContent = `Selected: ${sel}`;

        if (!cards) {
          renderNone(sel);
          return;
        }

        const found = findCard(sel);
        if (found) renderCard(sel, found);
        else renderNone(sel);
        return;
      }
    }
  }

  // Show which element we’re watching (truth probe)
  if (sourceEls.length) {
    elSource.textContent = "Watching: " + sourceEls.map(e => "#" + e.id).join(", ");
  } else {
    elSource.textContent = "Watching: (no HUD/build element found)";
  }

  // Load cards
  fetch(`./edu/aal_region_cards.json?cb=${Date.now()}`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      cards = data.cards || {};
      rebuildAliasIndex();
      updateFromSources();
    })
    .catch(err => {
      console.error("[EDU] failed to load cards:", err);
      elSummary.textContent = `Failed to load /model/edu/aal_region_cards.json (${String(err)}).`;
    });

  // Observe for selection changes
  const obs = new MutationObserver(() => updateFromSources());
  for (const el of sourceEls) {
    obs.observe(el, { childList: true, subtree: true, characterData: true });
  }

  // Fallback polling (cheap safety net)
  setInterval(updateFromSources, 400);
})();
