import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const BUILD_ID = "1772492801";
const VIEWER_STATE_STORAGE_KEY = "model.viewer.state.v1";
const AAL_LABEL_ALIASES = new Map([
  ["Frontal_Orb_Med", "Frontal_Med_Orb"],
  ["Frontal_Orb_Med_L", "Frontal_Med_Orb_L"],
  ["Frontal_Orb_Med_R", "Frontal_Med_Orb_R"],
]);
const CARD_LABEL_ALIASES = new Map([
  ["Frontal_Med_Orb", "Frontal_Orb_Med"],
  ["Frontal_Med_Orb_L", "Frontal_Orb_Med_L"],
  ["Frontal_Med_Orb_R", "Frontal_Orb_Med_R"],
]);



function prettyAalLabel(raw) {
  if (!raw) return "";

  // Hemisphere suffix
  let hemi = "";
  if (raw.endsWith("_L")) { hemi = "Left"; raw = raw.slice(0, -2); }
  else if (raw.endsWith("_R")) { hemi = "Right"; raw = raw.slice(0, -2); }

  // Token expansion
  const tok = {
    Sup: "Superior",
    Mid: "Middle",
    Inf: "Inferior",
    Ant: "Anterior",
    Post: "Posterior",
    Med: "Medial",
    Lat: "Lateral",
    Orb: "Orbital",
    Oper: "Opercular",
    Tri: "Triangular",
    Rol: "Rolandic",
    Rect: "Rectus",
    Supp: "Supplementary",
    Cingulum: "Cingulate",
    ParaHippocampal: "Parahippocampal",
  };

  let parts = raw.split("_").map(p => tok[p] || p);

  // Add spaces for CamelCase tokens if any
  parts = parts.map(p => p.replace(/([a-z])([A-Z])/g, "$1 $2"));

  // Small reorder heuristics
  const lobes = new Set(["Frontal", "Temporal", "Parietal", "Occipital"]);
  const desc  = new Set(["Superior", "Middle", "Inferior", "Medial", "Lateral", "Anterior", "Posterior", "Orbital"]);

  // "Frontal Superior" -> "Superior Frontal"
  if (parts.length >= 2 && lobes.has(parts[0]) && desc.has(parts[1])) {
    parts = [parts[1], parts[0], ...parts.slice(2)];
  }

  // "Cingulate Anterior" -> "Anterior Cingulate"
  if (parts.length >= 2 && parts[0] === "Cingulate" && (parts[1] === "Anterior" || parts[1] === "Posterior")) {
    parts = [parts[1], parts[0], ...parts.slice(2)];
  }

  let label = parts.join(" ");
  if (hemi) label += ` (${hemi})`;
  return label;
}

function canonicalNodeKey(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function addNodeSearchKey(lookup, key, idx) {
  const normalized = canonicalNodeKey(key);
  if (!normalized) return;
  if (!lookup.has(normalized)) lookup.set(normalized, idx);
}

function isTextEntryTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function resolveAalAlias(label) {
  return AAL_LABEL_ALIASES.get(label) || label;
}

function canonicalRegionLabel(label) {
  const raw = String(label || "").replace(/__\d+$/, "");
  return resolveAalAlias(raw);
}

// ---------- UI ----------
const buildEl = document.getElementById("build");
const hudEl = document.getElementById("hud");

const ui = {
  toggleEdges: document.getElementById("toggleEdges"),
  toggleHull:  document.getElementById("toggleHull"),
  toggleAuto:  document.getElementById("toggleAuto"),
  btnToggleRotate: document.getElementById("btnToggleRotate"),
  autoRotateStatus: document.getElementById("autoRotateStatus"),
  btnReset:    document.getElementById("btnReset"),
  edgeThresh:  document.getElementById("edgeThresh"),
  edgeVal:     document.getElementById("edgeVal"),
  nodeSearch:  document.getElementById("nodeSearch"),
  nodeSearchSuggestions: document.getElementById("nodeSearchSuggestions"),
  nodeSearchAutocomplete: document.getElementById("nodeSearchAutocomplete"),
  btnFindNode: document.getElementById("btnFindNode"),
  nodeSearchStatus: document.getElementById("nodeSearchStatus"),
  regionCardTitle: document.getElementById("regionCardTitle"),
  regionCardSummary: document.getElementById("regionCardSummary"),
  regionCardNetworks: document.getElementById("regionCardNetworks"),
  regionCardDisclaimer: document.getElementById("regionCardDisclaimer"),
};

function hud(msg, isError = false) {
  hudEl.textContent = msg;
  hudEl.classList.toggle("error", isError);
}

buildEl.textContent = `model • AAL viewer • BUILD ${BUILD_ID}`;

// ---------- State ----------
const state = {
  edgesOn: true,
  hullOn: true,
  autoRotate: true,
  edgeThreshold: 0.08,
};

function persistViewerState() {
  try {
    localStorage.setItem(VIEWER_STATE_STORAGE_KEY, JSON.stringify({
      edgesOn: state.edgesOn,
      hullOn: state.hullOn,
      autoRotate: state.autoRotate,
      edgeThreshold: state.edgeThreshold,
    }));
  } catch (_) {
    // Best-effort only; no-op in restricted environments.
  }
}

function restoreViewerState() {
  try {
    const raw = localStorage.getItem(VIEWER_STATE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return;

    if (typeof parsed.edgesOn === "boolean") state.edgesOn = parsed.edgesOn;
    if (typeof parsed.hullOn === "boolean") state.hullOn = parsed.hullOn;
    if (typeof parsed.autoRotate === "boolean") state.autoRotate = parsed.autoRotate;

    const threshold = Number(parsed.edgeThreshold);
    if (Number.isFinite(threshold)) {
      state.edgeThreshold = THREE.MathUtils.clamp(threshold, 0, 1);
    }
  } catch (_) {
    // Ignore malformed persisted state.
  }
}

restoreViewerState();

// ---------- Scene ----------
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(0, 1.2, 2.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = "none";

const controls = new OrbitControls(camera, renderer.domElement);
const DEFAULT_DAMPING_FACTOR = 0.08;
controls.enableDamping = true;
controls.dampingFactor = DEFAULT_DAMPING_FACTOR;
const AUTO_ROTATE_SPEED = 1.4;
controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
controls.target.set(0, 0.2, 0);
controls.update();
controls.saveState();

function setAutoRotateEnabled(enabled, persist = true) {
  const next = Boolean(enabled);
  state.autoRotate = next;
  controls.autoRotate = next;
  controls.autoRotateSpeed = next ? AUTO_ROTATE_SPEED : 0;
  controls.enableDamping = next;
  controls.dampingFactor = next ? DEFAULT_DAMPING_FACTOR : 0;

  if (!next) {
    // Flush any residual motion immediately when auto-rotate is turned off.
    controls.update();
  }

  if (ui.toggleAuto) ui.toggleAuto.checked = next;
  if (ui.btnToggleRotate) ui.btnToggleRotate.textContent = next ? "Stop rotate" : "Start rotate";
  if (ui.autoRotateStatus) ui.autoRotateStatus.textContent = `Rotation: ${next ? "ON" : "OFF"} (shortcut: R)`;
  if (persist) persistViewerState();
}

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(2, 3, 2);
scene.add(dir);

// ---------- Coordinate mapping ----------
const SCALE = 0.01; // 1 unit = 100mm
function mniToThree([x, y, z]) {
  return new THREE.Vector3(x * SCALE, z * SCALE, -y * SCALE);
}

// Cache-bust assets (OBJLoader doesn't give fetch cache controls)
const GRAPH_URL = `./assets/aal_graph.json?v=${BUILD_ID}`;
const HULL_URL  = `./assets/brain_hull.obj?v=${BUILD_ID}`;
const REGION_CARDS_URL = `./edu/aal_region_cards.json?v=${BUILD_ID}`;

// ---------- Graph/Hull refs ----------
let graph = null;
let nodeMesh = null;
let hullGroup = null;

let edgeLines = null;
let edgeHighlightLines = null;

// edgesFiltered = edges above threshold (used for selection & highlight)
// edgesShown = edges actually drawn (0 if edges toggled off)
let edgesFiltered = [];
let edgesShown = 0;

let hoveredIdx = null;
let selectedIdx = null;
let selectedNeighbors = new Set();
let regionCardsDisclaimer = "Educational summary (simplified). Not medical advice; not clinical diagnosis.";
let searchHighlightLabel = "";

// Node base data (for restoring after selection clears)
const nodeBase = []; // { pos: Vector3, baseScale: number, baseColor: Color }
const nodeSearchLookup = new Map();
const nodeSearchEntries = [];
const autocompleteMatches = [];
let autocompleteActiveIdx = -1;
const searchHighlightIndices = new Set();
const regionCardLookup = new Map();
const dummy = new THREE.Object3D();

// Shared raycast helpers
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function updateMouseFromEvent(ev) {
  mouse.x = (ev.clientX / innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / innerHeight) * 2 + 1;
}

// ---------- HUD ----------
function renderHud() {
  if (!graph) {
    hud(`BUILD ${BUILD_ID}\nLoading…`);
    return;
  }

  const lines = [];
  lines.push(`BUILD ${BUILD_ID}`);
  lines.push(`Nodes: ${graph.nodes.length} • Edges shown: ${edgesShown}`);
  lines.push(`Edge threshold: ${state.edgeThreshold.toFixed(2)} • Edges ${state.edgesOn ? "ON" : "OFF"} • Hull ${state.hullOn ? "ON" : "OFF"} • Auto ${state.autoRotate ? "ON" : "OFF"}`);

  if (selectedIdx !== null) {
    const n = graph.nodes[selectedIdx];
    lines.push(`Selected: ${prettyAalLabel(n.name)}  (${selectedNeighbors.size} neighbors)`);
    lines.push(`Tip: click empty space or press Esc to clear`);
  } else {
    lines.push(`Selected: none (click a node to select)`);
  }

  if (hoveredIdx !== null) {
    const h = graph.nodes[hoveredIdx];
    lines.push(`Hover: ${prettyAalLabel(h.name)}`);
  } else {
    lines.push(`Hover: none`);
  }

  if (searchHighlightIndices.size > 0) {
    const label = searchHighlightLabel || "search";
    lines.push(`Search highlight: ${searchHighlightIndices.size} nodes (${label})`);
  }

  hud(lines.join("\n"));
}

function registerRegionCard(label, card) {
  const key = String(label || "").trim();
  if (!key || !card) return;
  regionCardLookup.set(key, card);
  regionCardLookup.set(canonicalRegionLabel(key), card);
}

function lookupRegionCard(label) {
  const key = String(label || "").trim();
  if (!key) return null;
  if (regionCardLookup.has(key)) return regionCardLookup.get(key);

  const canonical = canonicalRegionLabel(key);
  if (regionCardLookup.has(canonical)) return regionCardLookup.get(canonical);

  const legacy = CARD_LABEL_ALIASES.get(key) || CARD_LABEL_ALIASES.get(canonical);
  if (legacy && regionCardLookup.has(legacy)) return regionCardLookup.get(legacy);
  return null;
}

function renderRegionCard(idx = null) {
  if (!ui.regionCardTitle || !ui.regionCardSummary || !ui.regionCardNetworks || !ui.regionCardDisclaimer) return;

  if (!graph || idx === null || idx === undefined || !graph.nodes?.[idx]) {
    ui.regionCardTitle.textContent = "Region role: none";
    ui.regionCardSummary.textContent = "Select a node to view a simplified educational summary for that region.";
    ui.regionCardNetworks.textContent = "Networks: n/a";
    ui.regionCardDisclaimer.textContent = regionCardsDisclaimer;
    return;
  }

  const rawLabel = graph.nodes[idx].name;
  const canonical = canonicalRegionLabel(rawLabel);
  const card = lookupRegionCard(canonical);
  const title = card?.title || prettyAalLabel(canonical);
  const summary = card?.summary || "Commonly involved in distributed neural processing depending on task context. Simplified educational summary.";
  const networks = Array.isArray(card?.networks) && card.networks.length ? card.networks.join(", ") : "n/a";

  ui.regionCardTitle.textContent = `Region role: ${title}`;
  ui.regionCardSummary.textContent = summary;
  ui.regionCardNetworks.textContent = `Networks: ${networks}`;
  ui.regionCardDisclaimer.textContent = regionCardsDisclaimer;
}

// ---------- Selection helpers ----------
function computeSelectedNeighbors() {
  selectedNeighbors = new Set();
  if (selectedIdx === null || !graph) return;

  for (const e of edgesFiltered) {
    if (e.source === selectedIdx) selectedNeighbors.add(e.target);
    else if (e.target === selectedIdx) selectedNeighbors.add(e.source);
  }
}

function applyNodeStyle() {
  if (!nodeMesh || !graph) return;

  computeSelectedNeighbors();

  const SELECT_COLOR = new THREE.Color(0xffe066);
  const NEIGH_COLOR  = new THREE.Color(0x9dffb0);
  const SEARCH_COLOR = new THREE.Color(0xffef7a);

  for (let i = 0; i < graph.nodes.length; i++) {
    const base = nodeBase[i];

    let scale = base.baseScale;
    let color = base.baseColor;

    if (selectedIdx !== null) {
      if (i === selectedIdx) {
        scale = base.baseScale * 1.70;
        color = SELECT_COLOR;
      } else if (selectedNeighbors.has(i)) {
        scale = base.baseScale * 1.25;
        color = NEIGH_COLOR;
      } else {
        // Dim non-participants to make selection legible
        const dim = base.baseColor.clone().multiplyScalar(0.25);
        color = dim;
      }
    }

    if (searchHighlightIndices.size > 0 && searchHighlightIndices.has(i)) {
      const highlightMix = selectedIdx === null ? 0.68 : 0.46;
      scale *= selectedIdx === null ? 1.34 : 1.18;
      color = color.clone().lerp(SEARCH_COLOR, highlightMix);
    }

    dummy.position.copy(base.pos);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    nodeMesh.setMatrixAt(i, dummy.matrix);
    nodeMesh.setColorAt(i, color);
  }

  nodeMesh.instanceMatrix.needsUpdate = true;
  nodeMesh.instanceColor.needsUpdate = true;
}

function clearSelection() {
  selectedIdx = null;
  applyNodeStyle();
  rebuildEdgeHighlight();
  renderRegionCard(null);
  renderHud();
}

function setSelection(idx) {
  selectedIdx = idx;
  applyNodeStyle();
  rebuildEdgeHighlight();
  renderRegionCard(idx);
  renderHud();
}

function setNodeSearchStatus(msg, isError = false) {
  if (!ui.nodeSearchStatus) return;
  ui.nodeSearchStatus.textContent = msg;
  ui.nodeSearchStatus.style.color = isError ? "#ff9b9b" : "";
}

function focusNodeByIndex(idx) {
  if (!graph || !nodeBase[idx]) return false;

  const targetPos = nodeBase[idx].pos.clone();
  const offset = camera.position.clone().sub(controls.target);
  if (offset.lengthSq() < 1e-8) {
    offset.set(0, 1.2, 2.2);
  }

  controls.target.copy(targetPos);
  camera.position.copy(targetPos.clone().add(offset));
  controls.update();
  setSelection(idx);
  return true;
}

function setSearchHighlight(indices, label = "") {
  searchHighlightIndices.clear();
  for (const idx of indices || []) {
    if (Number.isInteger(idx) && idx >= 0 && idx < (graph?.nodes?.length || 0)) {
      searchHighlightIndices.add(idx);
    }
  }
  searchHighlightLabel = label || "";
}

function scoreNodeSearchEntry(entry, normalizedQuery) {
  let best = -1;
  for (const key of entry.searchKeys) {
    if (key === normalizedQuery) return 420;
    if (key.startsWith(normalizedQuery)) {
      best = Math.max(best, 320 - Math.min(80, key.length - normalizedQuery.length));
    }
    const containsAt = key.indexOf(normalizedQuery);
    if (containsAt >= 0) {
      best = Math.max(best, 240 - Math.min(120, containsAt));
    }
    if (normalizedQuery.startsWith(key)) {
      best = Math.max(best, 180 - Math.min(120, normalizedQuery.length - key.length));
    }
  }
  return best;
}

function updateNodeSearchSuggestions() {
  if (!ui.nodeSearchSuggestions) return;
  ui.nodeSearchSuggestions.innerHTML = "";

  const limit = Math.min(nodeSearchEntries.length, 250);
  for (let i = 0; i < limit; i++) {
    const entry = nodeSearchEntries[i];
    const opt = document.createElement("option");
    opt.value = entry.displayLabel;
    if (entry.canonicalLabel !== entry.displayLabel) {
      opt.label = entry.canonicalLabel;
    }
    ui.nodeSearchSuggestions.appendChild(opt);
  }
}

function rebuildNodeSearchEntries() {
  nodeSearchEntries.length = 0;
  if (!graph || !Array.isArray(graph.nodes)) {
    updateNodeSearchSuggestions();
    return;
  }

  const grouped = new Map();
  for (let i = 0; i < graph.nodes.length; i++) {
    const canonical = canonicalRegionLabel(graph.nodes[i].name);
    if (!grouped.has(canonical)) grouped.set(canonical, []);
    grouped.get(canonical).push(i);
  }

  for (const [canonicalLabel, indices] of grouped.entries()) {
    const card = lookupRegionCard(canonicalLabel);
    const displayLabel = card?.title || prettyAalLabel(canonicalLabel);
    const aliasSet = new Set([
      canonicalLabel,
      canonicalLabel.replace(/_/g, " "),
      displayLabel,
      prettyAalLabel(canonicalLabel),
      prettyAalLabel(canonicalLabel).replace(/[()]/g, " "),
    ]);
    if (Array.isArray(card?.aliases)) {
      for (const alias of card.aliases) aliasSet.add(alias);
    }

    const searchKeys = [];
    for (const alias of aliasSet) {
      const key = canonicalNodeKey(alias);
      if (key) searchKeys.push(key);
    }

    nodeSearchEntries.push({
      canonicalLabel,
      displayLabel,
      indices: indices.slice(),
      searchKeys: [...new Set(searchKeys)],
    });
  }

  nodeSearchEntries.sort((a, b) => a.displayLabel.localeCompare(b.displayLabel));
  updateNodeSearchSuggestions();
}

function resolveNodeSearchMatches(query) {
  const normalized = canonicalNodeKey(query);
  if (!normalized) return [];

  if (nodeSearchEntries.length) {
    const matches = nodeSearchEntries
      .map((entry) => ({ entry, score: scoreNodeSearchEntry(entry, normalized) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => (b.score - a.score) || a.entry.displayLabel.localeCompare(b.entry.displayLabel));
    return matches;
  }

  if (nodeSearchLookup.has(normalized)) {
    const idx = nodeSearchLookup.get(normalized);
    return [{ entry: { displayLabel: prettyAalLabel(graph.nodes[idx]?.name || ""), indices: [idx] }, score: 100 }];
  }

  for (const [key, idx] of nodeSearchLookup.entries()) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return [{ entry: { displayLabel: prettyAalLabel(graph.nodes[idx]?.name || ""), indices: [idx] }, score: 60 }];
    }
  }

  return [];
}

function closeNodeSearchAutocomplete() {
  autocompleteMatches.length = 0;
  autocompleteActiveIdx = -1;
  if (!ui.nodeSearchAutocomplete) return;
  ui.nodeSearchAutocomplete.classList.remove("open");
  ui.nodeSearchAutocomplete.innerHTML = "";
}

function renderNodeSearchAutocomplete() {
  if (!ui.nodeSearchAutocomplete) return;

  if (!autocompleteMatches.length) {
    closeNodeSearchAutocomplete();
    return;
  }

  ui.nodeSearchAutocomplete.innerHTML = "";
  for (let i = 0; i < autocompleteMatches.length; i++) {
    const match = autocompleteMatches[i];
    const button = document.createElement("button");
    button.type = "button";
    if (i === autocompleteActiveIdx) button.classList.add("active");

    const title = document.createTextNode(match.entry.displayLabel);
    button.appendChild(title);

    const sub = document.createElement("span");
    sub.className = "sub";
    const nodeCount = match.entry.indices.length;
    sub.textContent = `${nodeCount} node${nodeCount === 1 ? "" : "s"}`;
    button.appendChild(sub);

    button.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
    });
    button.addEventListener("click", () => {
      autocompleteActiveIdx = i;
      applyActiveAutocompleteSelection(true);
    });
    ui.nodeSearchAutocomplete.appendChild(button);
  }

  ui.nodeSearchAutocomplete.classList.add("open");
}

function openNodeSearchAutocomplete(matches) {
  autocompleteMatches.length = 0;
  const limit = Math.min(matches.length, 8);
  for (let i = 0; i < limit; i++) autocompleteMatches.push(matches[i]);
  autocompleteActiveIdx = autocompleteMatches.length ? 0 : -1;
  renderNodeSearchAutocomplete();
}

function moveNodeSearchAutocomplete(delta) {
  if (!autocompleteMatches.length) return false;
  const len = autocompleteMatches.length;
  autocompleteActiveIdx = (autocompleteActiveIdx + delta + len) % len;
  renderNodeSearchAutocomplete();
  return true;
}

function applyActiveAutocompleteSelection(runSearch = true) {
  if (!autocompleteMatches.length || autocompleteActiveIdx < 0) return false;
  const match = autocompleteMatches[autocompleteActiveIdx];
  if (!match?.entry) return false;

  if (ui.nodeSearch) ui.nodeSearch.value = match.entry.displayLabel;
  closeNodeSearchAutocomplete();
  if (runSearch) runNodeSearch(match.entry.displayLabel);
  return true;
}

function refreshNodeSearchAutocomplete() {
  if (!ui.nodeSearch) return;
  const query = (ui.nodeSearch.value || "").trim();
  if (!query) {
    closeNodeSearchAutocomplete();
    return;
  }

  const matches = resolveNodeSearchMatches(query);
  if (!matches.length) {
    closeNodeSearchAutocomplete();
    return;
  }

  openNodeSearchAutocomplete(matches);
}

function runNodeSearch(rawQuery = null) {
  if (!graph) {
    setNodeSearchStatus("Graph still loading. Try again in a moment.", true);
    return;
  }

  const query = String(rawQuery ?? (ui.nodeSearch?.value || "")).trim();
  if (!query) {
    setSearchHighlight([], "");
    applyNodeStyle();
    renderHud();
    setNodeSearchStatus("Type a region and press Enter.");
    closeNodeSearchAutocomplete();
    return;
  }

  const matches = resolveNodeSearchMatches(query);
  if (!matches.length) {
    setSearchHighlight([], "");
    applyNodeStyle();
    renderHud();
    setNodeSearchStatus(`No match for "${query}".`, true);
    closeNodeSearchAutocomplete();
    return;
  }

  const bestScore = matches[0].score;
  const topMatches = matches.filter((m) => m.score === bestScore);
  const highlighted = new Set();
  for (const m of topMatches) {
    for (const idx of m.entry.indices) highlighted.add(idx);
  }

  const primaryIdx = topMatches[0].entry.indices[0];
  const topLabel = topMatches[0].entry.displayLabel;
  setSearchHighlight([...highlighted], topLabel);

  const ok = focusNodeByIndex(primaryIdx);
  if (!ok) {
    setSearchHighlight([], "");
    setNodeSearchStatus("Could not focus that node.", true);
    return;
  }

  const regionCount = topMatches.length;
  const nodeCount = highlighted.size;
  if (regionCount > 1) {
    setNodeSearchStatus(`Matched ${regionCount} regions • ${nodeCount} nodes lit.`);
  } else {
    setNodeSearchStatus(`Matched: ${topLabel} • ${nodeCount} node${nodeCount === 1 ? "" : "s"} lit.`);
  }
  closeNodeSearchAutocomplete();
}

// ---------- Edges ----------
function removeLines(objRefName) {
  const obj = objRefName === "base" ? edgeLines : edgeHighlightLines;
  if (!obj) return;

  scene.remove(obj);
  obj.geometry.dispose();
  obj.material.dispose();

  if (objRefName === "base") edgeLines = null;
  else edgeHighlightLines = null;
}

function rebuildEdges() {
  if (!graph) return;

  // Always compute the filtered set (used by selection neighbors)
  edgesFiltered = graph.edges.filter(e => (e.weight_norm ?? 0) >= state.edgeThreshold);

  // Remove old base edges
  removeLines("base");

  if (!state.edgesOn) {
    edgesShown = 0;
    rebuildEdgeHighlight(); // will hide highlight too
    applyNodeStyle();       // neighbors reflect threshold even if edges hidden
    renderHud();
    return;
  }

  edgesShown = edgesFiltered.length;

  const nodes = graph.nodes;
  const positions = new Float32Array(edgesFiltered.length * 2 * 3);

  for (let k = 0; k < edgesFiltered.length; k++) {
    const e = edgesFiltered[k];
    const a = mniToThree(nodes[e.source].mni_mm);
    const b = mniToThree(nodes[e.target].mni_mm);
    const base = k * 6;
    positions[base + 0] = a.x; positions[base + 1] = a.y; positions[base + 2] = a.z;
    positions[base + 3] = b.x; positions[base + 4] = b.y; positions[base + 5] = b.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
  edgeLines = new THREE.LineSegments(geo, mat);
  scene.add(edgeLines);

  rebuildEdgeHighlight();
  applyNodeStyle();
  renderHud();
}

function rebuildEdgeHighlight() {
  removeLines("highlight");

  if (!graph || selectedIdx === null || !state.edgesOn) return;

  const nodes = graph.nodes;
  const incident = edgesFiltered.filter(e => e.source === selectedIdx || e.target === selectedIdx);
  if (!incident.length) return;

  const positions = new Float32Array(incident.length * 2 * 3);

  for (let k = 0; k < incident.length; k++) {
    const e = incident[k];
    const a = mniToThree(nodes[e.source].mni_mm);
    const b = mniToThree(nodes[e.target].mni_mm);
    const base = k * 6;
    positions[base + 0] = a.x; positions[base + 1] = a.y; positions[base + 2] = a.z;
    positions[base + 3] = b.x; positions[base + 4] = b.y; positions[base + 5] = b.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.LineBasicMaterial({ color: 0xffffcc, transparent: true, opacity: 0.90 });
  edgeHighlightLines = new THREE.LineSegments(geo, mat);
  scene.add(edgeHighlightLines);
}

// ---------- Loaders ----------
async function loadGraph() {
  const r = await fetch(GRAPH_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`aal_graph.json HTTP ${r.status}`);
  return await r.json();
}

async function loadHullObj() {
  const loader = new OBJLoader();
  return await loader.loadAsync(HULL_URL);
}

async function loadRegionCards() {
  try {
    const r = await fetch(REGION_CARDS_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(`aal_region_cards.json HTTP ${r.status}`);
    const data = await r.json();
    const cards = data?.cards && typeof data.cards === "object" ? data.cards : {};

    regionCardLookup.clear();
    for (const [label, card] of Object.entries(cards)) {
      registerRegionCard(label, card);
      const canonical = canonicalRegionLabel(label);
      registerRegionCard(canonical, card);

      const legacy = CARD_LABEL_ALIASES.get(label) || CARD_LABEL_ALIASES.get(canonical);
      if (legacy) registerRegionCard(legacy, card);

      if (Array.isArray(card?.aliases)) {
        for (const alias of card.aliases) {
          registerRegionCard(alias, card);
        }
      }
    }

    if (typeof data?.disclaimer === "string" && data.disclaimer.trim()) {
      regionCardsDisclaimer = data.disclaimer.trim();
    }
  } catch (err) {
    console.warn("Region cards load failed:", err);
    regionCardLookup.clear();
  }
}

function addHull(obj) {
  obj.traverse((child) => {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.12,
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
    }
  });

  hullGroup = new THREE.Group();
  hullGroup.add(obj);

  // Basis transform: X'=x, Y'=z, Z'=-y
  const basis = new THREE.Matrix4().set(
    1,  0,  0, 0,
    0,  0,  1, 0,
    0, -1,  0, 0,
    0,  0,  0, 1
  );
  hullGroup.applyMatrix4(basis);
  hullGroup.scale.setScalar(SCALE);
  hullGroup.visible = state.hullOn;

  scene.add(hullGroup);
}

function addNodes(g) {
  const nodes = g.nodes;

  const sphereGeo = new THREE.SphereGeometry(0.018, 16, 16);
  const sphereMat = new THREE.MeshStandardMaterial({ color: 0x66ccff });

  nodeMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, nodes.length);
  nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const c = new THREE.Color();

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const pos = mniToThree(n.mni_mm);

    const baseScale = THREE.MathUtils.clamp(0.7 + 0.6 * Math.sqrt(n.volume_mm3 / 20000), 0.6, 1.8);

    if (n.hemisphere === "L") c.setHex(0xff7aa2);
    else if (n.hemisphere === "R") c.setHex(0x7ad7ff);
    else c.setHex(0xd6d6d6);

    nodeBase[i] = {
      pos,
      baseScale,
      baseColor: c.clone(),
    };

    addNodeSearchKey(nodeSearchLookup, n.name, i);
    addNodeSearchKey(nodeSearchLookup, n.name.replace(/_/g, " "), i);
    addNodeSearchKey(nodeSearchLookup, prettyAalLabel(n.name), i);
    addNodeSearchKey(nodeSearchLookup, prettyAalLabel(n.name).replace(/[()]/g, " "), i);

    dummy.position.copy(pos);
    dummy.scale.setScalar(baseScale);
    dummy.updateMatrix();
    nodeMesh.setMatrixAt(i, dummy.matrix);
    nodeMesh.setColorAt(i, c);
  }

  nodeMesh.instanceColor.needsUpdate = true;
  scene.add(nodeMesh);

  // Hover
  window.addEventListener("pointermove", (ev) => {
    updateMouseFromEvent(ev);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(nodeMesh);
    hoveredIdx = hits.length ? hits[0].instanceId : null;
    renderHud();
  });

  // Select (click)
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    updateMouseFromEvent(ev);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(nodeMesh);
    if (hits.length) setSelection(hits[0].instanceId);
    else clearSelection();
  });
}

// Esc clears selection
window.addEventListener("keydown", (ev) => {
  if (isTextEntryTarget(ev.target)) return;
  if (ev.key === "Escape") clearSelection();
  if (ev.code === "KeyR") {
    ev.preventDefault();
    setAutoRotateEnabled(!state.autoRotate, true);
    renderHud();
  }
});

// ---------- UI wiring ----------
function syncUI() {
  ui.toggleEdges.checked = state.edgesOn;
  ui.toggleHull.checked  = state.hullOn;
  ui.toggleAuto.checked  = state.autoRotate;
  ui.edgeThresh.value    = String(state.edgeThreshold);
  ui.edgeVal.textContent = state.edgeThreshold.toFixed(2);
}

ui.toggleEdges.addEventListener("change", () => {
  state.edgesOn = ui.toggleEdges.checked;
  persistViewerState();
  rebuildEdges();
});

ui.toggleHull.addEventListener("change", () => {
  state.hullOn = ui.toggleHull.checked;
  persistViewerState();
  if (hullGroup) hullGroup.visible = state.hullOn;
  renderHud();
});

ui.toggleAuto.addEventListener("change", () => {
  setAutoRotateEnabled(ui.toggleAuto.checked, true);
  renderHud();
});

if (ui.btnToggleRotate) {
  ui.btnToggleRotate.addEventListener("click", () => {
    setAutoRotateEnabled(!state.autoRotate, true);
    renderHud();
  });
}

ui.edgeThresh.addEventListener("input", () => {
  state.edgeThreshold = parseFloat(ui.edgeThresh.value);
  persistViewerState();
  ui.edgeVal.textContent = state.edgeThreshold.toFixed(2);
  rebuildEdges();
});

ui.btnFindNode.addEventListener("click", () => {
  if (autocompleteMatches.length) {
    applyActiveAutocompleteSelection(true);
    return;
  }
  runNodeSearch();
});

ui.nodeSearch.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    if (!autocompleteMatches.length) refreshNodeSearchAutocomplete();
    else moveNodeSearchAutocomplete(1);
    return;
  }

  if (ev.key === "ArrowUp") {
    ev.preventDefault();
    if (!autocompleteMatches.length) refreshNodeSearchAutocomplete();
    else moveNodeSearchAutocomplete(-1);
    return;
  }

  if (ev.key === "Escape") {
    closeNodeSearchAutocomplete();
    return;
  }

  if (ev.key === "Enter") {
    ev.preventDefault();
    if (autocompleteMatches.length) {
      applyActiveAutocompleteSelection(true);
      return;
    }
    runNodeSearch();
  }
});

ui.nodeSearch.addEventListener("change", () => {
  if ((ui.nodeSearch.value || "").trim()) runNodeSearch();
});

ui.nodeSearch.addEventListener("input", () => {
  if ((ui.nodeSearch.value || "").trim()) {
    refreshNodeSearchAutocomplete();
    return;
  }
  closeNodeSearchAutocomplete();
  setSearchHighlight([], "");
  applyNodeStyle();
  renderHud();
  setNodeSearchStatus("Type a region and press Enter.");
});

ui.nodeSearch.addEventListener("focus", () => {
  refreshNodeSearchAutocomplete();
});

ui.nodeSearch.addEventListener("blur", () => {
  window.setTimeout(() => {
    closeNodeSearchAutocomplete();
  }, 120);
});

window.addEventListener("pointerdown", (ev) => {
  if (!ui.nodeSearchAutocomplete || !ui.nodeSearch) return;
  const t = ev.target;
  if (ui.nodeSearchAutocomplete.contains(t) || t === ui.nodeSearch) return;
  closeNodeSearchAutocomplete();
});

ui.btnReset.addEventListener("click", () => {
  controls.reset();
  renderHud();
});

syncUI();
setAutoRotateEnabled(state.autoRotate, false);
renderRegionCard(null);
renderHud();

// ---------- Render loop ----------
function animate() {
  requestAnimationFrame(animate);
  if (!state.autoRotate) {
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0;
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Boot ----------
(async () => {
  try {
    hud(`BUILD ${BUILD_ID}\nLoading graph…`);
    graph = await loadGraph();

    addNodes(graph);
    rebuildNodeSearchEntries();
    rebuildEdges();

    hud(`BUILD ${BUILD_ID}\nGraph OK (${graph.nodes.length} nodes)\nLoading region cards…`);
    await loadRegionCards();
    rebuildNodeSearchEntries();
    renderRegionCard(selectedIdx);

    hud(`BUILD ${BUILD_ID}\nGraph OK (${graph.nodes.length} nodes)\nLoading hull…`);
    try {
      const hullObj = await loadHullObj();
      addHull(hullObj);
    } catch (e) {
      console.warn("Hull load failed:", e);
    }

    renderHud();
  } catch (e) {
    console.error(e);
    hud(`BUILD ${BUILD_ID}\nERROR\n${e.message}`, true);
  }
})();
