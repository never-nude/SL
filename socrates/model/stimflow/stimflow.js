import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const CORE_BUILD_ID = "1772481939";
const STIMFLOW_BUILD_ID = "1772498015";
const MILESTONE_LABEL = "SOCRATES";
const CACHE_BUST = `${CORE_BUILD_ID}-${STIMFLOW_BUILD_ID}`;

const GRAPH_DENSE_URL = `../assets/aal_graph_dense.json?v=${CACHE_BUST}`;
const GRAPH_URL = `../assets/aal_graph.json?v=${CACHE_BUST}`;
const HULL_URL = `../assets/brain_hull.obj?v=${CACHE_BUST}`;
const STIMULI_LIBRARY_URL = `./stimuli.library.json?v=${CACHE_BUST}`;
const STIMULI_EMPIRICAL_URL = `./stimuli.empirical.json?v=${CACHE_BUST}`;
const CONNECTIVITY_EMPIRICAL_URL = `./connectivity.empirical.json?v=${CACHE_BUST}`;
const STIMULI_TEMPLATE_URL = `./stimuli.template.json?v=${CACHE_BUST}`;
const REGION_CARDS_URL = `../edu/aal_region_cards.json?v=${CACHE_BUST}`;

const SCALE = 0.01;
const DEFAULT_HRF = { model: "canonical_bold_like", rise_s: 4, peak_s: 6, fall_s: 12 };
const VALID_TIERS = new Set([
  "TEMPLATE_META_ANALYTIC",
  "EMPIRICAL_TASK_FMRI",
  "SIMULATED_PROPAGATION",
]);
const CONFIDENCE_CLASSES = ["conf-low", "conf-medium", "conf-high"];
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
const PATH_SEQUENCE_LIMIT = 12;
const DEFAULT_SCRUB_STEP_S = 0.5;
const DEFAULT_ENGAGEMENT = {
  arrival_quantile: 0.88,
  edge_weight_min: 0.12,
  coactivation_lag_s: 2.6,
};
const MAJOR_REGION_LABELS = [
  "Frontal lobe",
  "Parietal lobe",
  "Temporal lobe",
  "Occipital lobe",
  "Insula",
  "Cingulate cortex",
  "Limbic medial temporal",
  "Thalamus",
  "Basal ganglia",
  "Cerebellum",
];
const SEARCH_HIGHLIGHT_PALETTE = [
  0xffef00,
  0x00e8ff,
  0xff62ff,
  0x61ff7a,
  0xff8a00,
];
const HULL_OPACITY = 0.72;
const HULL_OPACITY_MIN = 0.10;
const HULL_OPACITY_MAX = 0.95;

function prettyAalLabel(raw) {
  if (!raw) return "";
  raw = String(raw).replace(/__\d+$/, "");

  let hemi = "";
  if (raw.endsWith("_L")) { hemi = "Left"; raw = raw.slice(0, -2); }
  else if (raw.endsWith("_R")) { hemi = "Right"; raw = raw.slice(0, -2); }

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

  let parts = raw.split("_").map((p) => tok[p] || p);
  parts = parts.map((p) => p.replace(/([a-z])([A-Z])/g, "$1 $2"));

  const lobes = new Set(["Frontal", "Temporal", "Parietal", "Occipital"]);
  const desc = new Set(["Superior", "Middle", "Inferior", "Medial", "Lateral", "Anterior", "Posterior", "Orbital"]);

  if (parts.length >= 2 && lobes.has(parts[0]) && desc.has(parts[1])) {
    parts = [parts[1], parts[0], ...parts.slice(2)];
  }

  if (parts.length >= 2 && parts[0] === "Cingulate" && (parts[1] === "Anterior" || parts[1] === "Posterior")) {
    parts = [parts[1], parts[0], ...parts.slice(2)];
  }

  let label = parts.join(" ");
  if (hemi) label += ` (${hemi})`;
  return label;
}

function mniToThree([x, y, z]) {
  return new THREE.Vector3(x * SCALE, z * SCALE, -y * SCALE);
}

function clamp01(v) {
  return THREE.MathUtils.clamp(v, 0, 1);
}

function emit(type, detail) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function safeText(value, fallback = "") {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function normalizeSearchText(value) {
  return safeText(value)
    .toLowerCase()
    .replace(/__\d+$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isTextEntryTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function normalizeGraphMode(value) {
  const v = safeText(value, "auto").toLowerCase();
  if (v === "dense") return "dense";
  if (v === "core") return "core";
  return "auto";
}

function normalizeTier(value) {
  const tier = safeText(value, "TEMPLATE_META_ANALYTIC");
  return VALID_TIERS.has(tier) ? tier : "TEMPLATE_META_ANALYTIC";
}

function normalizeHrf(rawHrf) {
  const rise = Math.max(0.1, Number(rawHrf?.rise_s) || DEFAULT_HRF.rise_s);
  const peak = Math.max(rise, Number(rawHrf?.peak_s) || DEFAULT_HRF.peak_s);
  const fall = Math.max(0.1, Number(rawHrf?.fall_s) || DEFAULT_HRF.fall_s);
  const model = safeText(rawHrf?.model, DEFAULT_HRF.model);
  return { model, rise_s: rise, peak_s: peak, fall_s: fall };
}

function normalizeSeedRegions(rawSeedRegions) {
  if (!Array.isArray(rawSeedRegions)) return [];
  const out = [];

  for (const seed of rawSeedRegions) {
    const aalLabel = safeText(seed?.aal_label);
    const weight = Math.max(0, Number(seed?.w ?? seed?.weight) || 0);
    if (!aalLabel || weight <= 0) continue;
    out.push({ aal_label: aalLabel, w: weight });
  }

  return out;
}

function deriveStimulusId(rawStimulus, index) {
  const explicitId = safeText(rawStimulus?.id);
  if (explicitId) return explicitId;

  const fromLabel = safeText(rawStimulus?.label, `stimulus_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return fromLabel || `stimulus_${index + 1}`;
}

function normalizeStringList(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((v) => safeText(v))
    .filter(Boolean);
}

function normalizeEngagement(rawEngagement) {
  const q = Number(rawEngagement?.arrival_quantile);
  const edgeMin = Number(rawEngagement?.edge_weight_min);
  const lag = Number(rawEngagement?.coactivation_lag_s);
  return {
    arrival_quantile: clamp01(Number.isFinite(q) ? q : DEFAULT_ENGAGEMENT.arrival_quantile),
    edge_weight_min: THREE.MathUtils.clamp(
      Number.isFinite(edgeMin) ? edgeMin : DEFAULT_ENGAGEMENT.edge_weight_min,
      0,
      1
    ),
    coactivation_lag_s: THREE.MathUtils.clamp(
      Number.isFinite(lag) ? lag : DEFAULT_ENGAGEMENT.coactivation_lag_s,
      0.1,
      12
    ),
  };
}

function normalizeStimulus(rawStimulus, index) {
  const seedRegions = normalizeSeedRegions(rawStimulus?.seed_regions);
  if (!seedRegions.length) return null;

  const id = deriveStimulusId(rawStimulus, index);
  const label = safeText(rawStimulus?.label, id);
  const tier = normalizeTier(rawStimulus?.tier);
  const explanation = safeText(rawStimulus?.explanation, "Simplified educational summary.");
  const rawConfidence = Number(rawStimulus?.confidence);
  const confidence = Number.isFinite(rawConfidence) ? clamp01(rawConfidence) : 0.4;
  const evidenceType = safeText(
    rawStimulus?.evidence_type,
    tier === "EMPIRICAL_TASK_FMRI" ? "task-fMRI summary" : "template curation"
  );
  const datasets = normalizeStringList(rawStimulus?.datasets ?? rawStimulus?.data_sources);
  const citations = normalizeStringList(rawStimulus?.citations);
  const engagement = normalizeEngagement(rawStimulus?.engagement);

  return {
    id,
    label,
    tier,
    explanation,
    confidence,
    evidence_type: evidenceType,
    datasets,
    citations,
    engagement,
    seed_regions: seedRegions,
  };
}

function normalizeStimulusLibrary(rawLibrary, sourceName) {
  const hrf = normalizeHrf(rawLibrary?.hrf);
  const stimuli = [];

  const rawStimuli = Array.isArray(rawLibrary?.stimuli) ? rawLibrary.stimuli : [];
  for (let i = 0; i < rawStimuli.length; i++) {
    const normalized = normalizeStimulus(rawStimuli[i], i);
    if (normalized) stimuli.push(normalized);
  }

  if (!stimuli.length) {
    throw new Error(`No valid stimuli found in ${sourceName}`);
  }

  return {
    schema_version: Number(rawLibrary?.schema_version) || 1,
    source_name: sourceName,
    hrf,
    stimuli,
  };
}

function resolveAalAlias(label) {
  return AAL_LABEL_ALIASES.get(label) || label;
}

function canonicalNodeLabel(label) {
  const raw = safeText(label).replace(/__\d+$/, "");
  return resolveAalAlias(raw);
}

function expandSeedLabel(seed) {
  const rawLabel = safeText(seed?.aal_label);
  const rawWeight = Math.max(0, Number(seed?.w) || 0);
  if (!rawLabel || rawWeight <= 0) return [];

  const label = resolveAalAlias(rawLabel);
  if (labelToIndex.has(label)) return [{ aal_label: label, w: rawWeight }];

  if (label.endsWith("_L") || label.endsWith("_R")) return [];

  const leftLabel = resolveAalAlias(`${label}_L`);
  const rightLabel = resolveAalAlias(`${label}_R`);
  const hasLeft = labelToIndex.has(leftLabel);
  const hasRight = labelToIndex.has(rightLabel);

  if (hasLeft && hasRight) {
    return [
      { aal_label: leftLabel, w: rawWeight * 0.5 },
      { aal_label: rightLabel, w: rawWeight * 0.5 },
    ];
  }
  if (hasLeft) return [{ aal_label: leftLabel, w: rawWeight }];
  if (hasRight) return [{ aal_label: rightLabel, w: rawWeight }];
  return [];
}

function confidenceLevel(score) {
  const v = clamp01(Number(score) || 0);
  if (v >= 0.70) return { level: "high", className: "conf-high" };
  if (v >= 0.45) return { level: "medium", className: "conf-medium" };
  return { level: "low", className: "conf-low" };
}

function renderStimulusMeta(stimulus) {
  ui.stimExplain.textContent = stimulus.explanation || "Simplified educational summary.";

  if (!ui.stimConfidence) return;
  const confidence = confidenceLevel(stimulus.confidence);
  ui.stimConfidence.classList.remove(...CONFIDENCE_CLASSES);
  ui.stimConfidence.classList.add(confidence.className);
  ui.stimConfidence.textContent = `Signal confidence: ${confidence.level} (${clamp01(stimulus.confidence).toFixed(2)})`;
}

function libraryModeLabel(mode) {
  if (mode === "empirical") return "EMPIRICAL_ANCHORS";
  return "TEMPLATE_META_ANALYTIC";
}

function resolveLibraryMode(preferredMode) {
  if (preferredMode === "empirical" && stimulusLibraries.empirical) return "empirical";
  if (preferredMode === "template" && stimulusLibraries.template) return "template";
  if (stimulusLibraries.empirical) return "empirical";
  if (stimulusLibraries.template) return "template";
  return null;
}

function updateBasisStatus() {
  if (!ui.basisStatus) return;
  const mode = resolveLibraryMode(state.libraryMode);
  if (!mode) {
    ui.basisStatus.textContent = "Basis: unavailable";
    return;
  }
  const lib = stimulusLibraries[mode];
  const source = safeText(lib?.source_name, "unknown");
  const count = Array.isArray(lib?.stimuli) ? lib.stimuli.length : 0;
  ui.basisStatus.textContent = `Basis: ${libraryModeLabel(mode)} | ${count} stimuli | source ${source}`;
}

function updateGraphStatus() {
  if (!ui.graphStatus) return;
  if (!graph) {
    ui.graphStatus.textContent = `Graph: loading (${state.graphMode})`;
    return;
  }
  const requested = normalizeGraphMode(state.graphMode);
  const atlasMode = safeText(graph?.atlas?.mode, "aal_core");
  ui.graphStatus.textContent = `Graph: ${requested} -> ${atlasMode} | ${graph.nodes.length} nodes`;
}

function updateConnectivityStatus() {
  if (!ui.connectivityStatus) return;
  if (!connectivitySourceName) {
    ui.connectivityStatus.textContent = "Connectivity: loading...";
    return;
  }

  if (!activeStimulus) {
    if (!connectivityByStimulus.size) {
      ui.connectivityStatus.textContent = "Connectivity: baseline graph weights";
      return;
    }

    ui.connectivityStatus.textContent = `Connectivity: matrix loaded (${connectivityByStimulus.size} stimulus maps)`;
    return;
  }

  if (activeConnectivityEdgeCount > 0) {
    ui.connectivityStatus.textContent =
      `Connectivity: matrix ${activeConnectivityEdgeCount} links (${connectivitySourceName})`;
    return;
  }

  ui.connectivityStatus.textContent = `Connectivity: baseline graph weights (${connectivitySourceName})`;
}

const buildEl = document.getElementById("build");
const hudEl = document.getElementById("hud");
const query = new URLSearchParams(window.location.search);
const initialGraphMode = "dense";
const initialBreadthQ = THREE.MathUtils.clamp(Number(query.get("path_breadth_q")) || DEFAULT_ENGAGEMENT.arrival_quantile, 0.60, 0.98);

const ui = {
  uiModeSelect: document.getElementById("uiModeSelect"),
  uiModeHint: document.getElementById("uiModeHint"),
  basisBlock: document.getElementById("basisBlock"),
  graphBlock: document.getElementById("graphBlock"),
  scrubRateBlock: document.getElementById("scrubRateBlock"),
  arrivalJumpBlock: document.getElementById("arrivalJumpBlock"),
  narrationAdvancedBlock: document.getElementById("narrationAdvancedBlock"),
  breadthBlock: document.getElementById("breadthBlock"),
  exportBlock: document.getElementById("exportBlock"),
  pathOnlyBlock: document.getElementById("pathOnlyBlock"),
  reachedOnlyBlock: document.getElementById("reachedOnlyBlock"),
  radiationBlock: document.getElementById("radiationBlock"),
  hoverGroupBlock: document.getElementById("hoverGroupBlock"),
  edgeThresholdBlock: document.getElementById("edgeThresholdBlock"),
  basisSelect: document.getElementById("basisSelect"),
  basisStatus: document.getElementById("basisStatus"),
  graphSelect: document.getElementById("graphSelect"),
  graphStatus: document.getElementById("graphStatus"),
  connectivityStatus: document.getElementById("connectivityStatus"),
  stimSelect: document.getElementById("stimSelect"),
  modeSelect: document.getElementById("modeSelect"),
  speedRange: document.getElementById("speedRange"),
  speedVal: document.getElementById("speedVal"),
  gainRange: document.getElementById("gainRange"),
  gainVal: document.getElementById("gainVal"),
  breadthRange: document.getElementById("breadthRange"),
  breadthVal: document.getElementById("breadthVal"),
  btnPlay: document.getElementById("btnPlay"),
  btnPause: document.getElementById("btnPause"),
  btnStop: document.getElementById("btnStop"),
  btnStepBack: document.getElementById("btnStepBack"),
  btnStepForward: document.getElementById("btnStepForward"),
  btnPrevArrival: document.getElementById("btnPrevArrival"),
  btnNextArrival: document.getElementById("btnNextArrival"),
  timelineText: document.getElementById("timelineText"),
  scrubRange: document.getElementById("scrubRange"),
  scrubVal: document.getElementById("scrubVal"),
  scrubRateRange: document.getElementById("scrubRateRange"),
  scrubRateVal: document.getElementById("scrubRateVal"),
  statusText: document.getElementById("statusText"),
  progressFill: document.getElementById("progressFill"),
  stimConfidence: document.getElementById("stimConfidence"),
  stimExplain: document.getElementById("stimExplain"),
  majorRegionWords: document.getElementById("majorRegionWords"),
  majorRegionStatus: document.getElementById("majorRegionStatus"),
  pathSequence: document.getElementById("pathSequence"),
  btnExportJson: document.getElementById("btnExportJson"),
  btnExportCsv: document.getElementById("btnExportCsv"),
  exportStatus: document.getElementById("exportStatus"),
  regionSearchInput: document.getElementById("regionSearchInput"),
  regionSearchSuggest: document.getElementById("regionSearchSuggest"),
  btnRegionSearch: document.getElementById("btnRegionSearch"),
  btnRegionPrev: document.getElementById("btnRegionPrev"),
  btnRegionNext: document.getElementById("btnRegionNext"),
  regionSearchStatus: document.getElementById("regionSearchStatus"),
  regionTitle: document.getElementById("regionTitle"),
  regionSummary: document.getElementById("regionSummary"),
  regionNetworks: document.getElementById("regionNetworks"),
  toggleEdges: document.getElementById("toggleEdges"),
  togglePathOnly: document.getElementById("togglePathOnly"),
  toggleReachedOnly: document.getElementById("toggleReachedOnly"),
  toggleRadiation: document.getElementById("toggleRadiation"),
  toggleHoverGroup: document.getElementById("toggleHoverGroup"),
  toggleHull: document.getElementById("toggleHull"),
  hullOpacityRange: document.getElementById("hullOpacityRange"),
  hullOpacityVal: document.getElementById("hullOpacityVal"),
  toggleAuto: document.getElementById("toggleAuto"),
  toggleNarration: document.getElementById("toggleNarration"),
  narrationRateRange: document.getElementById("narrationRateRange"),
  narrationRateVal: document.getElementById("narrationRateVal"),
  btnNarrateNow: document.getElementById("btnNarrateNow"),
  btnNarrationMute: document.getElementById("btnNarrationMute"),
  narrationStatus: document.getElementById("narrationStatus"),
  btnReset: document.getElementById("btnReset"),
  edgeThresh: document.getElementById("edgeThresh"),
  edgeVal: document.getElementById("edgeVal"),
};

function hud(msg, isError = false) {
  hudEl.textContent = msg;
  hudEl.classList.toggle("error", isError);
}

buildEl.textContent = `STIMFLOW • ${MILESTONE_LABEL} • BUILD ${STIMFLOW_BUILD_ID}`;

const state = {
  graphMode: initialGraphMode,
  pathBreadthQ: initialBreadthQ,
  libraryMode: "empirical",
  edgesOn: true,
  pathOnly: true,
  reachedOnly: false,
  radiationOn: true,
  hoverGroupOn: false,
  hullOn: true,
  hullOpacity: HULL_OPACITY,
  autoRotate: true,
  edgeThreshold: 0.08,
  gain: 1.0,
  speed: 1.0,
  scrubStepS: DEFAULT_SCRUB_STEP_S,
  mode: "loop",
  narrationOn: false,
  narrationRate: 1.0,
  durationS: 25.0,
  running: false,
  paused: false,
  t: 0,
  lastMs: 0,
  uiMode: "advanced",
  searchExploreOn: false,
};

let graph = null;
let connectivitySourceName = "";
let connectivitySpec = null;
let activeConnectivityEdgeCount = 0;
let activeConnectivityMap = null;
let stimulusLibrary = null;
let stimulusLibraries = { template: null, empirical: null };
let activeStimulus = null;
let regionCards = null;
const regionCardLookup = new Map();

let nodeMesh = null;
let nodeHaloMesh = null;
let hullGroup = null;
let edgeLines = null;
let edgeHighlightLines = null;
let edgeFlow = [];

let edgesFiltered = [];
let edgesShown = 0;
let hoveredIdx = null;
let selectedIdx = null;
let selectedNeighbors = new Set();
let hoverGroupLabel = "";
const hoverGroupIndices = new Set();
let pathEdgeKeys = new Set();
let pathParent = [];
let reachableNodeCount = 0;
let latestReachedIdx = null;
let majorRegionsNow = [];
let arrivalEventsCache = [];
let lastNarratedArrivalCursor = -1;
let regionSearchQuery = "";
let regionSearchMatches = [];
let regionSearchCursor = -1;
let regionSuggestEntries = [];
let regionSuggestCursor = -1;
let searchExploreLabel = "";
const searchExploreIndices = new Set();

const nodeBase = []; // { pos, baseScale, baseColor }
const nodeActivation = [];
const nodeRelevant = [];
const adjacency = [];
const adjacencyBase = [];
const labelToIndex = new Map();
const labelToIndices = new Map();
const edgeKeySet = new Set();
const connectivityByStimulus = new Map();
const dummy = new THREE.Object3D();

let seedNodes = []; // { idx, w, distances, maxDist }
const nodeArrival = [];

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(0, 1.2, 2.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = "none";

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const DEFAULT_DAMPING_FACTOR = 0.08;
controls.dampingFactor = DEFAULT_DAMPING_FACTOR;
const AUTO_ROTATE_SPEED = 1.2;
controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
controls.target.set(0, 0.2, 0);
controls.update();
controls.saveState();

function setAutoRotateEnabled(enabled, syncCheckbox = true) {
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

  if (syncCheckbox && ui.toggleAuto) ui.toggleAuto.checked = next;
}

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 1.05);
dir.position.set(2, 3, 2);
scene.add(dir);

function updateMouseFromEvent(ev) {
  mouse.x = (ev.clientX / innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / innerHeight) * 2 + 1;
}

function hrfEnvelopeAt(t, hrf) {
  if (!hrf) return 0;
  const rise = Math.max(0.1, Number(hrf.rise_s) || 4);
  const peak = Math.max(rise, Number(hrf.peak_s) || 6);
  const fall = Math.max(0.1, Number(hrf.fall_s) || 12);
  const end = peak + fall;

  if (t <= 0) return 0;
  if (t < rise) return t / rise;
  if (t < peak) return 1;
  if (t < end) return 1 - ((t - peak) / fall);
  return 0;
}

function activationColor(v) {
  const t = clamp01(v);
  const c = new THREE.Color();
  c.setRGB(
    THREE.MathUtils.lerp(0.22, 1.00, t),
    THREE.MathUtils.lerp(0.30, 0.95, t),
    THREE.MathUtils.lerp(0.40, 0.86, t)
  );
  return c;
}

function temporalSpectrumColor(arrivalS, tSec, windowS) {
  const c = new THREE.Color();
  if (!Number.isFinite(arrivalS)) {
    c.setHex(0x8d9db1);
    return { color: c, phase: 0, active: false };
  }

  const localT = tSec - arrivalS;
  if (localT < 0) {
    c.setHex(0x4f6179);
    return { color: c, phase: 0, active: false };
  }

  const phase = clamp01(localT / Math.max(0.25, windowS));
  // Full spectrum progression: red on arrival -> blue as activation ages.
  const hue = THREE.MathUtils.lerp(0.00, 0.66, phase);
  const sat = THREE.MathUtils.lerp(0.90, 0.96, phase);
  const light = THREE.MathUtils.lerp(0.50, 0.56, phase);
  c.setHSL(hue, sat, light);
  return { color: c, phase, active: localT <= windowS };
}

function arrivalWavePulse(arrivalS, tSec) {
  if (!Number.isFinite(arrivalS)) return 0;
  const dt = tSec - arrivalS;
  if (dt < -0.45 || dt > 3.2) return 0;
  const center = 0.42;
  const sigma = 0.52;
  return Math.exp(-Math.pow(dt - center, 2) / (2 * sigma * sigma));
}

function edgeColorTo(target, v, isPath) {
  const t = clamp01(v);
  if (isPath) {
    target.setRGB(
      THREE.MathUtils.lerp(0.30, 0.96, t),
      THREE.MathUtils.lerp(0.38, 0.98, t),
      THREE.MathUtils.lerp(0.48, 1.00, t)
    );
    return;
  }

  target.setRGB(
    THREE.MathUtils.lerp(0.14, 0.40, t),
    THREE.MathUtils.lerp(0.16, 0.45, t),
    THREE.MathUtils.lerp(0.20, 0.52, t)
  );
}

function countReachedNodes(tSec) {
  let reached = 0;
  let latest = null;
  let latestT = -Infinity;
  for (let i = 0; i < nodeArrival.length; i++) {
    if (!nodeRelevant[i]) continue;
    const arrival = nodeArrival[i];
    if (!Number.isFinite(arrival) || arrival > tSec) continue;
    reached += 1;
    if (arrival >= latestT) {
      latestT = arrival;
      latest = i;
    }
  }
  return { reached, latest };
}

function collectArrivalEvents() {
  const events = [];
  for (let i = 0; i < nodeArrival.length; i++) {
    if (!nodeRelevant[i]) continue;
    const t = nodeArrival[i];
    if (!Number.isFinite(t)) continue;
    events.push({ idx: i, t });
  }
  events.sort((a, b) => (a.t - b.t) || (a.idx - b.idx));
  for (let i = 0; i < events.length; i++) {
    events[i].rank = i + 1;
  }
  return events;
}

function majorRegionForNodeLabel(label) {
  const canonical = canonicalNodeLabel(label);
  const base = canonical.replace(/_(L|R)$/i, "").toLowerCase();
  if (!base) return null;

  if (base.startsWith("insula")) return "Insula";
  if (base.startsWith("cingulum")) return "Cingulate cortex";
  if (base.startsWith("hippocampus") || base.startsWith("parahippocampal") || base.startsWith("amygdala")) {
    return "Limbic medial temporal";
  }
  if (base.startsWith("thalamus")) return "Thalamus";
  if (base.startsWith("caudate") || base.startsWith("putamen") || base.startsWith("pallidum")) {
    return "Basal ganglia";
  }
  if (base.startsWith("cerebellum") || base.startsWith("vermis")) return "Cerebellum";

  if (
    base.startsWith("frontal")
    || base.startsWith("precentral")
    || base.startsWith("rolandic_oper")
    || base.startsWith("supp_motor_area")
    || base.startsWith("olfactory")
    || base.startsWith("rectus")
  ) {
    return "Frontal lobe";
  }

  if (
    base.startsWith("parietal")
    || base.startsWith("postcentral")
    || base.startsWith("precuneus")
    || base.startsWith("supramarginal")
    || base.startsWith("angular")
    || base.startsWith("paracentral_lobule")
  ) {
    return "Parietal lobe";
  }

  if (base.startsWith("temporal") || base.startsWith("heschl")) return "Temporal lobe";

  if (
    base.startsWith("occipital")
    || base.startsWith("calcarine")
    || base.startsWith("cuneus")
    || base.startsWith("lingual")
    || base.startsWith("fusiform")
  ) {
    return "Occipital lobe";
  }

  return null;
}

function updateMajorRegionReadout() {
  if (!ui.majorRegionWords || !ui.majorRegionStatus) return;

  if (!graph || !activeStimulus) {
    majorRegionsNow = [];
    ui.majorRegionWords.textContent = "waiting...";
    ui.majorRegionStatus.textContent = "Major regions: n/a";
    return;
  }

  const scoreByRegion = new Map();
  for (const label of MAJOR_REGION_LABELS) scoreByRegion.set(label, 0);

  for (let i = 0; i < nodeActivation.length; i++) {
    const a = nodeActivation[i] || 0;
    if (a < 0.03) continue;
    const region = majorRegionForNodeLabel(graph.nodes[i]?.name || "");
    if (!region) continue;
    scoreByRegion.set(region, (scoreByRegion.get(region) || 0) + a);
  }

  const entries = [...scoreByRegion.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    majorRegionsNow = [];
    ui.majorRegionWords.textContent = "none";
    ui.majorRegionStatus.textContent = "Major regions: none (below activation threshold)";
    return;
  }

  const peak = Math.max(entries[0][1], 1e-6);
  const floor = Math.max(0.20, peak * 0.22);
  majorRegionsNow = entries
    .filter(([, score]) => score >= floor)
    .slice(0, 5)
    .map(([name, score]) => ({ name, score, rel: clamp01(score / peak) }));

  ui.majorRegionWords.textContent = "";
  for (let i = 0; i < majorRegionsNow.length; i++) {
    const item = majorRegionsNow[i];
    const token = document.createElement("span");
    token.className = i === 0 ? "token lead" : "token";
    token.textContent = item.name;
    token.style.opacity = (0.68 + (0.32 * item.rel)).toFixed(2);
    ui.majorRegionWords.appendChild(token);
  }

  ui.majorRegionStatus.textContent = `Major regions: ${majorRegionsNow.map((x) => x.name).join(" | ")}`;
}

function speechSynthesisAvailable() {
  return typeof window !== "undefined"
    && typeof window.speechSynthesis !== "undefined"
    && typeof window.SpeechSynthesisUtterance !== "undefined";
}

function refreshNarrationStatus(extra = "") {
  if (!ui.narrationStatus) return;
  if (!state.narrationOn) {
    ui.narrationStatus.textContent = "Narration: off";
    return;
  }
  ui.narrationStatus.textContent = extra || `Narration: on (${state.narrationRate.toFixed(2)}x)`;
}

function updateStepControls() {
  const step = THREE.MathUtils.clamp(Number(state.scrubStepS) || DEFAULT_SCRUB_STEP_S, 0.1, 2.0);
  if (ui.scrubRateVal) ui.scrubRateVal.textContent = `${step.toFixed(2)}s/step`;
  if (ui.scrubRateRange) ui.scrubRateRange.value = step.toFixed(2);
  if (ui.btnStepBack) ui.btnStepBack.textContent = `-${step.toFixed(2)}s`;
  if (ui.btnStepForward) ui.btnStepForward.textContent = `+${step.toFixed(2)}s`;
}

function setElementVisible(el, visible) {
  if (!el) return;
  el.style.display = visible ? "" : "none";
}

function setUIMode(mode) {
  const resolved = mode === "advanced" ? "advanced" : "basic";
  state.uiMode = resolved;
  const showAdvanced = resolved === "advanced";

  const advancedBlocks = [
    ui.basisBlock,
    ui.graphBlock,
    ui.scrubRateBlock,
    ui.arrivalJumpBlock,
    ui.narrationAdvancedBlock,
    ui.breadthBlock,
    ui.exportBlock,
    ui.pathOnlyBlock,
    ui.reachedOnlyBlock,
    ui.radiationBlock,
    ui.hoverGroupBlock,
    ui.edgeThresholdBlock,
  ];
  for (const block of advancedBlocks) setElementVisible(block, showAdvanced);

  if (ui.uiModeSelect) ui.uiModeSelect.value = resolved;
  if (ui.uiModeHint) {
    ui.uiModeHint.textContent = showAdvanced
      ? "Advanced mode: all technical controls shown."
      : "Basic mode: essential controls only.";
  }
}

function updateNarrationCursorFromTime() {
  const eps = 1e-5;
  let cursor = -1;
  for (let i = 0; i < arrivalEventsCache.length; i++) {
    if (arrivalEventsCache[i].t <= (state.t + eps)) cursor = i;
    else break;
  }
  lastNarratedArrivalCursor = cursor;
}

function narrationTextForEvent(event) {
  if (!graph || !event) return "";
  const node = graph.nodes[event.idx];
  const label = node?.name || "";
  const card = lookupRegionCard(label);
  const title = safeText(card?.title, prettyAalLabel(label) || "region");
  const summary = safeText(
    card?.summary,
    "Commonly involved in distributed network communication depending on task context."
  );
  const firstSentence = safeText(summary.split(/(?<=[.!?])\s+/)[0], summary);
  return `Pathway step ${event.rank}. ${title} reached at ${event.t.toFixed(1)} seconds. ${firstSentence}`;
}

function speakNarration(text, force = false) {
  if (!text) return false;
  if (!speechSynthesisAvailable()) {
    if (ui.narrationStatus) ui.narrationStatus.textContent = "Narration: speech API unavailable";
    return false;
  }
  if (!force && !state.narrationOn) return false;

  const synth = window.speechSynthesis;
  if (!force && (synth.speaking || synth.pending)) return false;
  if (force) synth.cancel();

  const utter = new window.SpeechSynthesisUtterance(text);
  utter.rate = THREE.MathUtils.clamp(Number(state.narrationRate) || 1, 0.6, 1.8);
  utter.pitch = 1.0;
  utter.volume = 1.0;
  utter.onstart = () => refreshNarrationStatus(`Narration: speaking (${state.narrationRate.toFixed(2)}x)`);
  utter.onend = () => refreshNarrationStatus();
  utter.onerror = () => refreshNarrationStatus("Narration: speech error");
  synth.speak(utter);
  return true;
}

function stopNarration() {
  if (speechSynthesisAvailable()) {
    window.speechSynthesis.cancel();
  }
  refreshNarrationStatus("Narration: silenced");
}

function narrateNextArrival(force = false) {
  if (!arrivalEventsCache.length) {
    refreshNarrationStatus("Narration: no arrival events");
    return false;
  }
  const eps = 1e-5;
  const next = arrivalEventsCache.find((ev) => ev.t > (state.t + eps)) || null;
  if (!next) {
    refreshNarrationStatus("Narration: at final arrival");
    return false;
  }
  const spoke = speakNarration(narrationTextForEvent(next), force);
  if (spoke) {
    const idx = arrivalEventsCache.findIndex((ev) => ev.idx === next.idx && ev.t === next.t);
    if (idx >= 0) lastNarratedArrivalCursor = idx;
  }
  return spoke;
}

function narrateProgress(prevT, nextT) {
  if (!state.narrationOn || !arrivalEventsCache.length || !speechSynthesisAvailable()) return;
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) return;

  const eps = 1e-5;
  for (let i = Math.max(0, lastNarratedArrivalCursor + 1); i < arrivalEventsCache.length; i++) {
    const ev = arrivalEventsCache[i];
    if (ev.t <= (prevT + eps)) {
      lastNarratedArrivalCursor = i;
      continue;
    }
    if (ev.t <= (nextT + eps)) {
      const spoke = speakNarration(narrationTextForEvent(ev), false);
      if (spoke) lastNarratedArrivalCursor = i;
    }
    break;
  }
}

function jumpToArrival(direction) {
  if (!graph || !activeStimulus) return;
  const events = collectArrivalEvents();
  if (!events.length) {
    setStatus("no arrival events");
    return;
  }

  const eps = 1e-5;
  let target = null;

  if (direction > 0) {
    target = events.find((ev) => ev.t > (state.t + eps)) || null;
    if (!target) {
      setStatus("at final arrival");
      return;
    }
  } else {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].t < (state.t - eps)) {
        target = events[i];
        break;
      }
    }
    if (!target) {
      setStatus("at first arrival");
      return;
    }
  }

  setTimelinePosition(target.t, direction > 0 ? "jump_next" : "jump_prev");
  setSelection(target.idx);
}

function lookupRegionCard(label) {
  if (!regionCards || !regionCards.cards) return null;
  label = String(label || "").replace(/__\d+$/, "");
  if (regionCardLookup.has(label)) return regionCardLookup.get(label);

  const canonical = resolveAalAlias(label);
  if (regionCardLookup.has(canonical)) return regionCardLookup.get(canonical);

  const legacy = CARD_LABEL_ALIASES.get(label) || CARD_LABEL_ALIASES.get(canonical);
  if (legacy && regionCardLookup.has(legacy)) return regionCardLookup.get(legacy);
  return null;
}

function renderRegionRole(idx) {
  if (!ui.regionTitle || !ui.regionSummary || !ui.regionNetworks || !graph || idx === null || idx === undefined) {
    if (ui.regionTitle) ui.regionTitle.textContent = "Region role: none";
    if (ui.regionSummary) ui.regionSummary.textContent = "Select a node or press Play to follow network activation.";
    if (ui.regionNetworks) ui.regionNetworks.textContent = "Networks: n/a";
    return;
  }

  const node = graph.nodes[idx];
  const label = node?.name || "";
  const card = lookupRegionCard(label);
  const title = card?.title || prettyAalLabel(label);
  const summary = card?.summary || "Commonly involved in distributed network communication depending on task context.";
  const networks = Array.isArray(card?.networks) && card.networks.length ? card.networks.join(", ") : "n/a";

  ui.regionTitle.textContent = `Region role: ${title}`;
  ui.regionSummary.textContent = summary;
  ui.regionNetworks.textContent = `Networks: ${networks}`;
}

function setRegionSearchStatus(text) {
  if (!ui.regionSearchStatus) return;
  ui.regionSearchStatus.textContent = text;
}

function resetRegionSearchStatus() {
  setRegionSearchStatus("Search: enter region");
}

function renderPathSequence(limit = PATH_SEQUENCE_LIMIT) {
  if (!ui.pathSequence) return;
  if (!graph || !activeStimulus) {
    ui.pathSequence.textContent = "waiting...";
    return;
  }

  const arrivals = [];
  for (let i = 0; i < nodeArrival.length; i++) {
    const t = nodeArrival[i];
    if (Number.isFinite(t)) arrivals.push({ idx: i, t });
  }
  arrivals.sort((a, b) => a.t - b.t);

  if (!arrivals.length) {
    ui.pathSequence.textContent = "No reachable nodes.";
    return;
  }

  const lines = [];
  const slice = arrivals.slice(0, limit);
  for (let i = 0; i < slice.length; i++) {
    const item = slice[i];
    const node = graph.nodes[item.idx];
    const label = node?.name || "";
    const card = lookupRegionCard(label);
    const title = card?.title || prettyAalLabel(label);
    const reachedMark = item.t <= state.t ? "*" : " ";
    const seedMark = pathParent[item.idx] === -1 ? " [seed]" : "";
    lines.push(
      `${reachedMark} ${(i + 1).toString().padStart(2, "0")}  ${item.t.toFixed(2)}s  ${title}${seedMark}`
    );
  }

  const remainder = arrivals.length - slice.length;
  if (remainder > 0) lines.push(`... +${remainder} more`);
  ui.pathSequence.textContent = lines.join("\n");
}

function regionMatchScore(canonicalLabel, haystack, query) {
  if (!query) return 0;
  let score = 0;

  const labelQuery = query.replace(/\s+/g, "_");
  if (canonicalLabel.toLowerCase() === labelQuery) score += 120;
  if (canonicalLabel.toLowerCase().startsWith(labelQuery)) score += 90;
  if (haystack.startsWith(query)) score += 75;

  const firstIdx = haystack.indexOf(query);
  if (firstIdx >= 0) score += Math.max(0, 60 - firstIdx);

  const tokens = query.split(" ").filter(Boolean);
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (canonicalLabel.toLowerCase().includes(tok)) score += 20;
  }
  return score;
}

function regionMatchHaystack(canonicalLabel) {
  const card = lookupRegionCard(canonicalLabel);
  const cardTitle = safeText(card?.title, "");
  const aliases = Array.isArray(card?.aliases) ? card.aliases.join(" ") : "";
  const raw = canonicalLabel.replace(/_/g, " ");
  const pretty = prettyAalLabel(canonicalLabel);
  return normalizeSearchText(`${raw} ${pretty} ${cardTitle} ${aliases}`);
}

function computeRegionSearchMatches(rawQuery) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return [];

  const tokens = query.split(" ").filter(Boolean);
  if (!tokens.length) return [];

  const matches = [];
  for (const [canonicalLabel, indices] of labelToIndices.entries()) {
    const haystack = regionMatchHaystack(canonicalLabel);
    const allTokensPresent = tokens.every((tok) => haystack.includes(tok));
    if (!allTokensPresent) continue;

    matches.push({
      canonical: canonicalLabel,
      indices,
      score: regionMatchScore(canonicalLabel, haystack, query),
    });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.canonical.localeCompare(b.canonical);
  });
  return matches;
}

function hideRegionSearchSuggest() {
  regionSuggestEntries = [];
  regionSuggestCursor = -1;
  if (!ui.regionSearchSuggest) return;
  ui.regionSearchSuggest.hidden = true;
  ui.regionSearchSuggest.innerHTML = "";
}

function renderRegionSearchSuggest(entries, cursor = 0) {
  if (!ui.regionSearchSuggest) return;
  regionSuggestEntries = entries.slice(0, 8);
  if (!regionSuggestEntries.length) {
    hideRegionSearchSuggest();
    return;
  }

  regionSuggestCursor = THREE.MathUtils.clamp(cursor, 0, regionSuggestEntries.length - 1);
  ui.regionSearchSuggest.innerHTML = "";

  for (let i = 0; i < regionSuggestEntries.length; i++) {
    const match = regionSuggestEntries[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `item${i === regionSuggestCursor ? " active" : ""}`;
    btn.dataset.idx = String(i);
    btn.textContent = `${prettyAalLabel(match.canonical)} (${match.indices.length})`;
    ui.regionSearchSuggest.appendChild(btn);
  }

  ui.regionSearchSuggest.hidden = false;
}

function updateRegionAutocomplete(rawQuery) {
  const query = normalizeSearchText(rawQuery);
  if (!query || query.length < 2) {
    hideRegionSearchSuggest();
    return;
  }

  const matches = computeRegionSearchMatches(query);
  if (!matches.length) {
    hideRegionSearchSuggest();
    return;
  }

  renderRegionSearchSuggest(matches, 0);
}

function acceptRegionSuggestion(index) {
  const entry = regionSuggestEntries[index];
  if (!entry) return false;

  if (ui.regionSearchInput) {
    ui.regionSearchInput.value = prettyAalLabel(entry.canonical);
  }

  const ok = rebuildRegionSearch(entry.canonical);
  hideRegionSearchSuggest();
  return ok;
}

function clearSearchExplore() {
  state.searchExploreOn = false;
  searchExploreLabel = "";
  searchExploreIndices.clear();
}

function setSearchExplore(match) {
  if (!match || !Array.isArray(match.indices) || !match.indices.length) {
    clearSearchExplore();
    return;
  }

  state.searchExploreOn = true;
  searchExploreLabel = match.canonical;
  searchExploreIndices.clear();
  for (const idx of match.indices) {
    if (Number.isInteger(idx)) searchExploreIndices.add(idx);
  }
}

function searchExploreColor(idx) {
  const paletteIndex = Math.abs(Number(idx) || 0) % SEARCH_HIGHLIGHT_PALETTE.length;
  return new THREE.Color(SEARCH_HIGHLIGHT_PALETTE[paletteIndex]);
}

function updateHoverGroup() {
  hoverGroupIndices.clear();
  hoverGroupLabel = "";

  if (!graph || !state.hoverGroupOn || hoveredIdx === null) return;
  const node = graph.nodes[hoveredIdx];
  const canonical = canonicalNodeLabel(node?.name || "");
  if (!canonical) return;

  const matches = labelToIndices.get(canonical) || [];
  hoverGroupLabel = canonical;
  for (const idx of matches) hoverGroupIndices.add(idx);
}

function setHoveredIndex(nextIdx) {
  const normalized = Number.isInteger(nextIdx) ? nextIdx : null;
  if (hoveredIdx === normalized) return;
  hoveredIdx = normalized;
  updateHoverGroup();
  if (state.hoverGroupOn) applyNodeStyle();
  renderHud();
}

function applyRegionSearchMatch(index, reason = "search") {
  if (!regionSearchMatches.length) return false;
  const count = regionSearchMatches.length;
  const normalized = ((index % count) + count) % count;
  regionSearchCursor = normalized;
  const match = regionSearchMatches[regionSearchCursor];
  const idx = match?.indices?.[0];

  if (Number.isInteger(idx)) {
    setSelection(idx);
    setHoveredIndex(idx);
  } else {
    renderHud();
  }

  setSearchExplore(match);
  if (state.running && !state.paused) {
    state.paused = true;
  }
  applyActivationAtTime(state.t);

  const regionName = prettyAalLabel(match.canonical);
  setRegionSearchStatus(`Search: ${regionSearchCursor + 1}/${count} ${regionName} (${match.indices.length} nodes)`);
  setStatus(`search ${reason}: ${regionName} (explore view)`);
  hideRegionSearchSuggest();
  return true;
}

function rebuildRegionSearch(rawQuery) {
  const query = normalizeSearchText(rawQuery);
  regionSearchQuery = query;
  regionSearchMatches = computeRegionSearchMatches(query);
  regionSearchCursor = -1;
  hideRegionSearchSuggest();

  if (!query) {
    clearSearchExplore();
    applyActivationAtTime(state.t);
    resetRegionSearchStatus();
    return false;
  }

  if (!regionSearchMatches.length) {
    clearSearchExplore();
    applyActivationAtTime(state.t);
    setRegionSearchStatus(`Search: no matches for "${query}"`);
    setStatus(`search: no matches`);
    return false;
  }

  return applyRegionSearchMatch(0, "find");
}

function cycleRegionSearch(delta) {
  if (!ui.regionSearchInput) return;
  const query = normalizeSearchText(ui.regionSearchInput.value);
  const needsRefresh = query !== regionSearchQuery || !regionSearchMatches.length;
  if (needsRefresh) {
    const ok = rebuildRegionSearch(ui.regionSearchInput.value);
    if (!ok) return;
    return;
  }

  const count = regionSearchMatches.length;
  if (!count) return;
  applyRegionSearchMatch(regionSearchCursor + delta, delta > 0 ? "next" : "prev");
}

function setExportStatus(text) {
  if (!ui.exportStatus) return;
  ui.exportStatus.textContent = `Export: ${text}`;
}

function csvCell(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return str;
}

function slugify(value, fallback = "stimulus") {
  const base = safeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || fallback;
}

function collectArrivalRecords() {
  if (!graph || !activeStimulus) return [];

  const arrivals = [];
  for (let i = 0; i < nodeArrival.length; i++) {
    const t = nodeArrival[i];
    if (!Number.isFinite(t)) continue;
    const node = graph.nodes[i];
    const label = node?.name || "";
    const card = lookupRegionCard(label);
    const title = card?.title || prettyAalLabel(label);
    const networks = Array.isArray(card?.networks) ? card.networks.slice() : [];
    const parentIdx = pathParent[i];
    const parentLabel = parentIdx >= 0 ? (graph.nodes[parentIdx]?.name || "") : "";
    const parentCard = parentIdx >= 0 ? lookupRegionCard(parentLabel) : null;
    const parentTitle = parentCard?.title || (parentLabel ? prettyAalLabel(parentLabel) : "");

    arrivals.push({
      idx: i,
      arrival_s: t,
      is_seed: parentIdx === -1,
      aal_label: label,
      title,
      networks,
      parent_idx: parentIdx,
      parent_aal_label: parentLabel,
      parent_title: parentTitle,
    });
  }

  arrivals.sort((a, b) => a.arrival_s - b.arrival_s);
  for (let i = 0; i < arrivals.length; i++) {
    arrivals[i].rank = i + 1;
    arrivals[i].reached_at_export_t = arrivals[i].arrival_s <= state.t;
  }
  return arrivals;
}

function currentExportContext() {
  const mode = resolveLibraryMode(state.libraryMode) || "template";
  const sourceName = safeText(stimulusLibrary?.source_name, "unknown");
  return {
    basis: mode,
    basis_label: libraryModeLabel(mode),
    source_name: sourceName,
  };
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function exportPathReportJson() {
  const records = collectArrivalRecords();
  if (!records.length) {
    setExportStatus("no path data");
    return;
  }

  const ctx = currentExportContext();
  const payload = {
    schema_version: 1,
    build_id: STIMFLOW_BUILD_ID,
    generated_at_utc: new Date().toISOString(),
    route: "/model/stimflow/",
    basis: ctx.basis,
    basis_label: ctx.basis_label,
    stimulus_library_source: ctx.source_name,
    stimulus: {
      id: activeStimulus.id,
      label: activeStimulus.label,
      tier: activeStimulus.tier,
      confidence: activeStimulus.confidence,
      evidence_type: activeStimulus.evidence_type,
      datasets: activeStimulus.datasets || [],
      citations: activeStimulus.citations || [],
    },
    settings: {
      mode: state.mode,
      speed: state.speed,
      gain: state.gain,
      edge_threshold: state.edgeThreshold,
      edges_on: state.edgesOn,
      path_only: state.pathOnly,
      reached_only: state.reachedOnly,
      radiation_on: state.radiationOn,
      hull_on: state.hullOn,
      auto_rotate: state.autoRotate,
      connectivity_source: connectivitySourceName || "graph-only",
      connectivity_adjusted_links: activeConnectivityEdgeCount,
      timeline_t_s: state.t,
      timeline_duration_s: state.durationS,
      engagement: activeStimulus.engagement || DEFAULT_ENGAGEMENT,
      path_breadth_quantile: state.pathBreadthQ,
    },
    graph: {
      nodes_total: graph.nodes.length,
      edges_total: graph.edges.length,
      edges_visible: edgesShown,
      atlas_mode: safeText(graph.atlas?.mode, "aal_core"),
      nodes_reachable: reachableNodeCount > 0 ? reachableNodeCount : records.length,
      path_links: pathEdgeKeys.size,
    },
    arrivals: records,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `stimflow_path_${slugify(activeStimulus.id)}_${ctx.basis}_${stamp}.json`;
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  downloadBlob(name, blob);

  setExportStatus(`JSON downloaded (${records.length} nodes)`);
  emit("stimflow:export", {
    format: "json",
    rows: records.length,
    basis: ctx.basis,
    stimulus_id: activeStimulus.id,
    build_id: STIMFLOW_BUILD_ID,
  });
}

function exportPathReportCsv() {
  const records = collectArrivalRecords();
  if (!records.length) {
    setExportStatus("no path data");
    return;
  }

  const ctx = currentExportContext();
  const headers = [
    "rank",
    "arrival_s",
    "reached_at_export_t",
    "is_seed",
    "aal_label",
    "title",
    "parent_aal_label",
    "parent_title",
    "networks",
    "stimulus_id",
    "stimulus_label",
    "stimulus_tier",
    "basis",
    "source_name",
    "timeline_t_s",
    "timeline_duration_s",
    "speed",
    "gain",
    "edge_threshold",
    "engagement_arrival_quantile",
    "engagement_edge_weight_min",
    "engagement_coactivation_lag_s",
    "connectivity_source",
    "connectivity_adjusted_links",
    "path_only",
    "reached_only",
    "radiation_on",
    "edges_on",
  ];

  const rows = records.map((r) => [
    r.rank,
    r.arrival_s.toFixed(4),
    r.reached_at_export_t ? 1 : 0,
    r.is_seed ? 1 : 0,
    r.aal_label,
    r.title,
    r.parent_aal_label,
    r.parent_title,
    r.networks.join("|"),
    activeStimulus.id,
    activeStimulus.label,
    activeStimulus.tier,
    ctx.basis,
    ctx.source_name,
    state.t.toFixed(4),
    state.durationS.toFixed(4),
    state.speed.toFixed(4),
    state.gain.toFixed(4),
    state.edgeThreshold.toFixed(4),
    Number(activeStimulus?.engagement?.arrival_quantile ?? DEFAULT_ENGAGEMENT.arrival_quantile).toFixed(4),
    Number(activeStimulus?.engagement?.edge_weight_min ?? DEFAULT_ENGAGEMENT.edge_weight_min).toFixed(4),
    Number(activeStimulus?.engagement?.coactivation_lag_s ?? DEFAULT_ENGAGEMENT.coactivation_lag_s).toFixed(4),
    connectivitySourceName || "graph-only",
    activeConnectivityEdgeCount,
    state.pathOnly ? 1 : 0,
    state.reachedOnly ? 1 : 0,
    state.radiationOn ? 1 : 0,
    state.edgesOn ? 1 : 0,
  ]);

  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `stimflow_path_${slugify(activeStimulus.id)}_${ctx.basis}_${stamp}.csv`;
  const blob = new Blob([`${csv}\n`], { type: "text/csv;charset=utf-8" });
  downloadBlob(name, blob);

  setExportStatus(`CSV downloaded (${records.length} nodes)`);
  emit("stimflow:export", {
    format: "csv",
    rows: records.length,
    basis: ctx.basis,
    stimulus_id: activeStimulus.id,
    build_id: STIMFLOW_BUILD_ID,
  });
}

function updatePathReadout() {
  if (!graph) return;
  const { latest } = countReachedNodes(state.t);
  latestReachedIdx = latest;
  const focusIdx = selectedIdx !== null ? selectedIdx : latest;
  renderRegionRole(focusIdx);
  renderPathSequence();
}

function renderHud() {
  if (!graph) {
    hud(`${MILESTONE_LABEL}\nLoading viewer...`);
    return;
  }

  const lines = [];
  lines.push(`${MILESTONE_LABEL} • BUILD ${STIMFLOW_BUILD_ID}`);
  lines.push(`Stimulus: ${activeStimulus ? activeStimulus.label : "none"}`);
  const reachedInfo = countReachedNodes(state.t);
  const reachedTotal = reachableNodeCount > 0 ? reachableNodeCount : graph.nodes.length;
  const playbackState = state.running ? (state.paused ? "Paused" : "Playing") : "Stopped";
  lines.push(`Time: ${state.t.toFixed(2)}s / ${state.durationS.toFixed(2)}s • ${playbackState}`);
  lines.push(`Reached: ${reachedInfo.reached}/${reachedTotal} nodes`);
  lines.push(`Major regions: ${majorRegionsNow.length ? majorRegionsNow.map((x) => x.name).join(", ") : "none"}`);
  if (state.searchExploreOn && searchExploreIndices.size > 0) {
    lines.push(`Explore: ${prettyAalLabel(searchExploreLabel)} (${searchExploreIndices.size} nodes)`);
  }

  if (selectedIdx !== null) {
    lines.push(`Selected: ${prettyAalLabel(graph.nodes[selectedIdx].name)}`);
  } else {
    lines.push("Selected: none");
  }

  if (hoveredIdx !== null) {
    lines.push(`Hover: ${prettyAalLabel(graph.nodes[hoveredIdx].name)}`);
  } else {
    lines.push("Hover: none");
  }

  hud(lines.join("\n"));
  updatePathReadout();
}

function setStatus(text) {
  if (ui.statusText) ui.statusText.textContent = text;
}

function setTimelinePosition(nextT, reason = "scrub") {
  const t = THREE.MathUtils.clamp(Number(nextT) || 0, 0, state.durationS);
  state.t = t;
  state.paused = true;
  state.lastMs = performance.now();

  const reachedInfo = countReachedNodes(state.t);
  const latestLabel = reachedInfo.latest !== null
    ? prettyAalLabel(graph?.nodes?.[reachedInfo.latest]?.name || "")
    : "n/a";

  const stepLabel = state.scrubStepS.toFixed(2);
  if (reason === "step_back") {
    setStatus(`paused (step -${stepLabel}s)`);
  } else if (reason === "step_forward") {
    setStatus(`paused (step +${stepLabel}s)`);
  } else if (reason === "jump_next") {
    setStatus(`paused (next arrival: ${latestLabel})`);
  } else if (reason === "jump_prev") {
    setStatus(`paused (prev arrival: ${latestLabel})`);
  } else if (state.running) {
    setStatus("paused (scrub)");
  }

  applyActivationAtTime(state.t);
  updateNarrationCursorFromTime();
  renderHud();
  emit("stimflow:frame", {
    stimulus_id: activeStimulus?.id || null,
    t: state.t,
    speed: state.speed,
    gain: state.gain,
    build_id: STIMFLOW_BUILD_ID,
  });
}

function renderTimeline() {
  ui.timelineText.textContent = `t=${state.t.toFixed(2)}s / ${state.durationS.toFixed(2)}s`;
  const p = clamp01(state.t / state.durationS);
  ui.progressFill.style.width = `${(p * 100).toFixed(1)}%`;
  if (ui.scrubRange) {
    ui.scrubRange.max = state.durationS.toFixed(2);
    ui.scrubRange.value = Math.min(state.t, state.durationS).toFixed(2);
  }
  if (ui.scrubVal) {
    ui.scrubVal.textContent = `${state.t.toFixed(2)}s`;
  }
}

function computeSelectedNeighbors() {
  selectedNeighbors = new Set();
  if (selectedIdx === null) return;
  for (const e of edgesFiltered) {
    if (e.source === selectedIdx) selectedNeighbors.add(e.target);
    else if (e.target === selectedIdx) selectedNeighbors.add(e.source);
  }
}

function applyNodeStyle() {
  if (!nodeMesh || !graph) return;

  computeSelectedNeighbors();
  const searchMode = state.searchExploreOn && searchExploreIndices.size > 0;
  const hrf = stimulusLibrary?.hrf || DEFAULT_HRF;
  const phaseWindowS = Math.max(0.5, (Number(hrf.peak_s) || 6) + (Number(hrf.fall_s) || 12));

  const selectColor = new THREE.Color(0xf2f7ff);
  const neighColor = new THREE.Color(0xc8d6e8);
  const hoverColor = new THREE.Color(0xd5e8ff);
  const haloDormant = new THREE.Color(0x7d90a6);
  const searchDimColor = new THREE.Color(0x16202e);
  const haloColor = new THREE.Color();

  for (let i = 0; i < graph.nodes.length; i++) {
    const base = nodeBase[i];
    let scale = base.baseScale;
    let color = base.baseColor.clone();

    if (searchMode) {
      const isMatch = searchExploreIndices.has(i);
      if (isMatch) {
        color.copy(searchExploreColor(i));
        scale *= selectedIdx === i ? 1.72 : 1.46;
        if (selectedIdx === i) color.lerp(selectColor, 0.20);
      } else {
        color.copy(searchDimColor);
        scale *= 0.42;
      }

      dummy.position.copy(base.pos);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      nodeMesh.setMatrixAt(i, dummy.matrix);
      nodeMesh.setColorAt(i, color);

      if (nodeHaloMesh) {
        let haloIntensity = isMatch ? 0.22 : 0;
        if (selectedIdx === i) haloIntensity = Math.max(haloIntensity, 0.38);
        const haloScale = haloIntensity > 0.005
          ? base.baseScale * (2.20 + (3.60 * haloIntensity))
          : 0.0001;
        dummy.position.copy(base.pos);
        dummy.scale.setScalar(haloScale);
        dummy.updateMatrix();
        nodeHaloMesh.setMatrixAt(i, dummy.matrix);

        if (haloIntensity > 0.005) {
          haloColor.copy(searchExploreColor(i)).multiplyScalar(0.58 + (1.45 * haloIntensity));
        } else {
          haloColor.copy(haloDormant).multiplyScalar(0.01);
        }
        nodeHaloMesh.setColorAt(i, haloColor);
      }
      continue;
    }

    const a = nodeActivation[i] || 0;
    const phaseColor = temporalSpectrumColor(nodeArrival[i], state.t, phaseWindowS).color;
    if (a > 0) {
      const hot = activationColor(a);
      hot.lerp(phaseColor, 0.78);
      color.lerp(hot, 0.58 + (0.78 * a));
      scale *= 1 + (0.62 * a);
    }

    if (activeStimulus && !nodeRelevant[i]) {
      color.multiplyScalar(0.42);
      scale *= 0.88;
    }

    if (activeStimulus && state.reachedOnly) {
      const reached = Number.isFinite(nodeArrival[i]) && nodeArrival[i] <= state.t;
      if (!reached) {
        color.multiplyScalar(nodeRelevant[i] ? 0.18 : 0.10);
        scale *= nodeRelevant[i] ? 0.62 : 0.50;
      } else {
        color.lerp(new THREE.Color(0xf7fbff), 0.08);
      }
    }

    if (selectedIdx !== null) {
      if (i === selectedIdx) {
        scale *= 1.30;
        color.lerp(selectColor, 0.70);
      } else if (selectedNeighbors.has(i)) {
        scale *= 1.12;
        color.lerp(neighColor, 0.40);
      } else {
        color.multiplyScalar(0.33);
      }
    }

    if (state.hoverGroupOn && hoverGroupIndices.size > 0) {
      if (hoverGroupIndices.has(i)) {
        const isHovered = hoveredIdx === i;
        scale *= isHovered ? 1.26 : 1.10;
        color.lerp(hoverColor, isHovered ? 0.62 : 0.30);
      } else if (selectedIdx === null) {
        color.multiplyScalar(0.46);
      }
    }

    dummy.position.copy(base.pos);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    nodeMesh.setMatrixAt(i, dummy.matrix);
    nodeMesh.setColorAt(i, color);

    if (nodeHaloMesh) {
      let haloIntensity = 0;
      if (state.radiationOn && activeStimulus && nodeRelevant[i]) {
        const wave = 1.25 * arrivalWavePulse(nodeArrival[i], state.t);
        const sustain = 0.52 * a;
        const dt = Number.isFinite(nodeArrival[i]) ? (nodeArrival[i] - state.t) : Infinity;
        const preArrival = dt >= 0 && dt < 0.45 ? (0.12 * (1 - (dt / 0.45))) : 0;
        haloIntensity = clamp01(Math.max(wave, sustain, preArrival));

        if (state.reachedOnly) {
          const reached = Number.isFinite(nodeArrival[i]) && nodeArrival[i] <= state.t;
          if (!reached) haloIntensity *= 0.22;
        }
      }

      if (selectedIdx !== null && i === selectedIdx) {
        haloIntensity = Math.max(haloIntensity, 0.24);
      }

      const haloScale = haloIntensity > 0.005
        ? base.baseScale * (2.00 + (4.50 * haloIntensity))
        : 0.0001;
      dummy.position.copy(base.pos);
      dummy.scale.setScalar(haloScale);
      dummy.updateMatrix();
      nodeHaloMesh.setMatrixAt(i, dummy.matrix);

      if (haloIntensity > 0.005) {
        const hot = activationColor(Math.max(a, haloIntensity));
        haloColor.copy(phaseColor).lerp(hot, 0.40);
        haloColor.multiplyScalar(0.70 + (1.80 * haloIntensity));
      } else {
        haloColor.copy(haloDormant).multiplyScalar(0.015);
      }
      nodeHaloMesh.setColorAt(i, haloColor);
    }
  }

  nodeMesh.instanceMatrix.needsUpdate = true;
  nodeMesh.instanceColor.needsUpdate = true;
  if (nodeHaloMesh) {
    nodeHaloMesh.instanceMatrix.needsUpdate = true;
    nodeHaloMesh.instanceColor.needsUpdate = true;
    nodeHaloMesh.visible = searchMode || state.radiationOn;
  }
}

function clearSelection() {
  selectedIdx = null;
  applyNodeStyle();
  rebuildEdgeHighlight();
  renderHud();
}

function setSelection(idx) {
  selectedIdx = idx;
  applyNodeStyle();
  rebuildEdgeHighlight();
  renderHud();
}

function removeLines(kind) {
  const obj = kind === "base" ? edgeLines : edgeHighlightLines;
  if (!obj) return;
  scene.remove(obj);
  obj.geometry.dispose();
  obj.material.dispose();
  if (kind === "base") edgeLines = null;
  else edgeHighlightLines = null;
}

function updateEdgeColors() {
  if (!edgeLines || !graph || !state.edgesOn) return;
  const hrf = stimulusLibrary?.hrf || DEFAULT_HRF;
  const phaseWindowS = Math.max(0.5, (Number(hrf.peak_s) || 6) + (Number(hrf.fall_s) || 12));

  const colAttr = edgeLines.geometry.getAttribute("color");
  if (!colAttr) return;
  const arr = colAttr.array;

  const srcColor = new THREE.Color();
  const dstColor = new THREE.Color();

  for (let k = 0; k < edgesFiltered.length; k++) {
    const e = edgesFiltered[k];
    const flow = edgeFlow[k];
    const isPathEdge = flow?.isPath === true;
    const sourceReached = Number.isFinite(nodeArrival[e.source]) && nodeArrival[e.source] <= state.t;
    const targetReached = Number.isFinite(nodeArrival[e.target]) && nodeArrival[e.target] <= state.t;
    const edgeReached = sourceReached && targetReached;
    const sustain = clamp01(0.55 * ((nodeActivation[e.source] || 0) + (nodeActivation[e.target] || 0)));

    let sourcePulse = 0;
    let targetPulse = 0;
    if (flow && isPathEdge && Number.isFinite(flow.start)) {
      const sigma = 0.18;
      const rawHead = (state.t - flow.start) / (flow.span + 0.55);
      const sourceAnchor = flow.dir === 1 ? 0 : 1;
      const targetAnchor = flow.dir === 1 ? 1 : 0;
      const inWindow = rawHead >= -0.2 && rawHead <= 1.35;
      if (inWindow) {
        sourcePulse = Math.exp(-Math.pow(rawHead - sourceAnchor, 2) / (2 * sigma * sigma));
        targetPulse = Math.exp(-Math.pow(rawHead - targetAnchor, 2) / (2 * sigma * sigma));
      }
    }

    const baseline = isPathEdge ? 0.10 : 0.02;
    const sustainGain = isPathEdge ? 0.42 : 0.12;
    const pulseGain = isPathEdge ? 0.95 : 0.00;
    const sourceI = clamp01(baseline + (sustainGain * sustain) + (pulseGain * sourcePulse));
    const targetI = clamp01(baseline + (sustainGain * sustain) + (pulseGain * targetPulse));
    if (state.reachedOnly && !edgeReached) {
      edgeColorTo(srcColor, 0.01, false);
      edgeColorTo(dstColor, 0.01, false);
    } else {
      if (isPathEdge) {
        const sourceArrival = temporalSpectrumColor(nodeArrival[e.source], state.t, phaseWindowS).color;
        const targetArrival = temporalSpectrumColor(nodeArrival[e.target], state.t, phaseWindowS).color;
        const sourceHot = activationColor(sourceI);
        const targetHot = activationColor(targetI);
        srcColor.copy(sourceArrival).lerp(sourceHot, 0.35);
        dstColor.copy(targetArrival).lerp(targetHot, 0.35);
        srcColor.multiplyScalar(0.30 + (1.40 * sourceI));
        dstColor.multiplyScalar(0.30 + (1.40 * targetI));
      } else {
        edgeColorTo(srcColor, sourceI, false);
        edgeColorTo(dstColor, targetI, false);
      }
    }

    const base = k * 6;
    arr[base + 0] = srcColor.r; arr[base + 1] = srcColor.g; arr[base + 2] = srcColor.b;
    arr[base + 3] = dstColor.r; arr[base + 4] = dstColor.g; arr[base + 5] = dstColor.b;
  }

  colAttr.needsUpdate = true;
}

function rebuildEdges() {
  if (!graph) return;

  const thresholded = graph.edges.filter((e) => (e.weight_norm ?? 0) >= state.edgeThreshold);
  edgesFiltered = state.pathOnly
    ? thresholded.filter((e) => pathEdgeKeys.has(edgeKey(e.source, e.target)))
    : thresholded;
  removeLines("base");

  if (!state.edgesOn) {
    edgesShown = 0;
    rebuildEdgeHighlight();
    applyNodeStyle();
    renderHud();
    return;
  }

  edgesShown = edgesFiltered.length;
  edgeFlow = edgesFiltered.map((e) => {
    const isPath = pathEdgeKeys.has(edgeKey(e.source, e.target));
    const a = nodeArrival[e.source];
    const b = nodeArrival[e.target];
    if (!isPath || !Number.isFinite(a) || !Number.isFinite(b)) {
      return { start: Infinity, span: 1, dir: 1, isPath: false };
    }
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    return {
      start,
      span: Math.max(0.25, end - start),
      dir: a <= b ? 1 : -1,
      isPath: true,
    };
  });

  const positions = new Float32Array(edgesFiltered.length * 6);
  const colors = new Float32Array(edgesFiltered.length * 6);
  const baseColor = new THREE.Color();
  edgeColorTo(baseColor, 0.02, false);

  for (let k = 0; k < edgesFiltered.length; k++) {
    const e = edgesFiltered[k];
    const a = mniToThree(graph.nodes[e.source].mni_mm);
    const b = mniToThree(graph.nodes[e.target].mni_mm);
    const base = k * 6;

    positions[base + 0] = a.x; positions[base + 1] = a.y; positions[base + 2] = a.z;
    positions[base + 3] = b.x; positions[base + 4] = b.y; positions[base + 5] = b.z;

    colors[base + 0] = baseColor.r; colors[base + 1] = baseColor.g; colors[base + 2] = baseColor.b;
    colors[base + 3] = baseColor.r; colors[base + 4] = baseColor.g; colors[base + 5] = baseColor.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.90,
  });

  edgeLines = new THREE.LineSegments(geo, mat);
  scene.add(edgeLines);

  updateEdgeColors();
  rebuildEdgeHighlight();
  renderHud();
}

function rebuildEdgeHighlight() {
  removeLines("highlight");
  if (!graph || selectedIdx === null || !state.edgesOn) return;

  const incident = edgesFiltered.filter((e) => e.source === selectedIdx || e.target === selectedIdx);
  if (!incident.length) return;

  const positions = new Float32Array(incident.length * 6);
  for (let k = 0; k < incident.length; k++) {
    const e = incident[k];
    const a = mniToThree(graph.nodes[e.source].mni_mm);
    const b = mniToThree(graph.nodes[e.target].mni_mm);
    const base = k * 6;
    positions[base + 0] = a.x; positions[base + 1] = a.y; positions[base + 2] = a.z;
    positions[base + 3] = b.x; positions[base + 4] = b.y; positions[base + 5] = b.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xf2f7ff, transparent: true, opacity: 0.95 });
  edgeHighlightLines = new THREE.LineSegments(geo, mat);
  scene.add(edgeHighlightLines);
}

function addHull(obj) {
  obj.traverse((child) => {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        color: 0xe6edf8,
        transparent: true,
        opacity: state.hullOpacity,
        roughness: 0.86,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    }
  });

  hullGroup = new THREE.Group();
  hullGroup.add(obj);

  const basis = new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, -1, 0, 0,
    0, 0, 0, 1
  );
  hullGroup.applyMatrix4(basis);
  hullGroup.scale.setScalar(SCALE);
  hullGroup.visible = state.hullOn;
  scene.add(hullGroup);
  applyHullOpacity(state.hullOpacity);
}

function addNodes(g) {
  const sphereGeo = new THREE.SphereGeometry(0.014, 14, 14);
  const sphereMat = new THREE.MeshStandardMaterial({ color: 0x67c6ff });
  const haloGeo = new THREE.SphereGeometry(0.040, 12, 12);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x8ec9ff,
    vertexColors: true,
    transparent: true,
    opacity: 0.62,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const nodeSizeMultiplier = g.nodes.length > 1000 ? 0.72 : 0.84;

  nodeMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, g.nodes.length);
  nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nodeHaloMesh = new THREE.InstancedMesh(haloGeo, haloMat, g.nodes.length);
  nodeHaloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nodeHaloMesh.renderOrder = 2;
  nodeHaloMesh.frustumCulled = false;

  labelToIndex.clear();
  labelToIndices.clear();
  edgeKeySet.clear();

  const c = new THREE.Color();
  for (let i = 0; i < g.nodes.length; i++) {
    const n = g.nodes[i];
    const pos = mniToThree(n.mni_mm);
    const baseScale = THREE.MathUtils.clamp(
      (0.58 + 0.48 * Math.sqrt(n.volume_mm3 / 20000)) * nodeSizeMultiplier,
      0.36,
      1.08
    );

    if (n.hemisphere === "L") c.setHex(0x667286);
    else if (n.hemisphere === "R") c.setHex(0x6b778a);
    else c.setHex(0x636d7c);

    nodeBase[i] = { pos, baseScale, baseColor: c.clone() };
    nodeActivation[i] = 0;
    nodeRelevant[i] = false;
    nodeArrival[i] = Infinity;
    adjacency[i] = [];
    adjacencyBase[i] = [];
    labelToIndex.set(n.name, i);
    const canonical = canonicalNodeLabel(n.name);
    if (!labelToIndices.has(canonical)) labelToIndices.set(canonical, []);
    labelToIndices.get(canonical).push(i);

    dummy.position.copy(pos);
    dummy.scale.setScalar(baseScale);
    dummy.updateMatrix();
    nodeMesh.setMatrixAt(i, dummy.matrix);
    nodeMesh.setColorAt(i, c);

    dummy.scale.setScalar(0.0001);
    dummy.updateMatrix();
    nodeHaloMesh.setMatrixAt(i, dummy.matrix);
    nodeHaloMesh.setColorAt(i, c.clone().multiplyScalar(0.02));
  }

  for (const e of g.edges) {
    const w = Number(e.weight_norm) || 0;
    adjacencyBase[e.source].push({ to: e.target, w });
    adjacencyBase[e.target].push({ to: e.source, w });
    edgeKeySet.add(edgeKey(e.source, e.target));
  }

  applyStimulusConnectivity(null);

  nodeMesh.instanceColor.needsUpdate = true;
  nodeHaloMesh.instanceColor.needsUpdate = true;
  nodeHaloMesh.visible = state.radiationOn;
  scene.add(nodeHaloMesh);
  scene.add(nodeMesh);

  window.addEventListener("pointermove", (ev) => {
    updateMouseFromEvent(ev);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(nodeMesh);
    setHoveredIndex(hits.length ? hits[0].instanceId : null);
  });

  renderer.domElement.addEventListener("pointerleave", () => {
    setHoveredIndex(null);
  });

  renderer.domElement.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    updateMouseFromEvent(ev);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(nodeMesh);
    if (hits.length) setSelection(hits[0].instanceId);
    else clearSelection();
  });
}

function dijkstraFrom(startIdx) {
  const n = graph.nodes.length;
  const dist = new Array(n).fill(Infinity);
  const seen = new Array(n).fill(false);
  dist[startIdx] = 0;

  for (let step = 0; step < n; step++) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!seen[i] && dist[i] < bestD) {
        best = i;
        bestD = dist[i];
      }
    }
    if (best === -1) break;
    seen[best] = true;

    for (const nb of adjacency[best]) {
      const edgeCost = 1 / Math.max(0.04, nb.w);
      const cand = dist[best] + edgeCost;
      if (cand < dist[nb.to]) dist[nb.to] = cand;
    }
  }

  return dist;
}

function buildMultiSourcePathModel(seedIndices) {
  const n = graph.nodes.length;
  const dist = new Array(n).fill(Infinity);
  const parent = new Array(n).fill(-1);
  const seen = new Array(n).fill(false);

  for (const idx of seedIndices) {
    if (Number.isInteger(idx) && idx >= 0 && idx < n) {
      dist[idx] = 0;
    }
  }

  for (let step = 0; step < n; step++) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!seen[i] && dist[i] < bestD) {
        best = i;
        bestD = dist[i];
      }
    }
    if (best === -1) break;
    seen[best] = true;

    for (const nb of adjacency[best]) {
      const edgeCost = 1 / Math.max(0.04, nb.w);
      const cand = dist[best] + edgeCost;
      if (cand < dist[nb.to]) {
        dist[nb.to] = cand;
        parent[nb.to] = best;
      }
    }
  }

  return { dist, parent };
}

function quantileCutoff(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) return Infinity;
  const sorted = values.slice().sort((a, b) => a - b);
  const q = clamp01(Number.isFinite(quantile) ? quantile : 1);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

function normalizeConnectivityPair(rawPair) {
  const from = canonicalNodeLabel(rawPair?.from ?? rawPair?.a ?? rawPair?.source ?? rawPair?.left);
  const to = canonicalNodeLabel(rawPair?.to ?? rawPair?.b ?? rawPair?.target ?? rawPair?.right);
  const rawScale = Number(rawPair?.scale ?? rawPair?.multiplier ?? rawPair?.w);
  const scale = THREE.MathUtils.clamp(
    Number.isFinite(rawScale) ? rawScale : 1,
    0.2,
    3.5
  );

  if (!from || !to || from === to || !Number.isFinite(scale) || scale === 1) return null;
  return { from, to, scale };
}

function normalizeConnectivitySpec(rawSpec) {
  const source_name = safeText(rawSpec?.source_name, "connectivity.empirical.json");
  const globalPairsRaw = Array.isArray(rawSpec?.global_pairs) ? rawSpec.global_pairs : [];
  const global_pairs = globalPairsRaw
    .map((pair) => normalizeConnectivityPair(pair))
    .filter(Boolean);

  const stimuli = new Map();
  const rawStimuli = rawSpec?.stimuli;

  if (Array.isArray(rawStimuli)) {
    for (const rawItem of rawStimuli) {
      const id = safeText(rawItem?.id);
      if (!id) continue;
      const pairs = Array.isArray(rawItem?.pairs)
        ? rawItem.pairs.map((pair) => normalizeConnectivityPair(pair)).filter(Boolean)
        : [];
      if (pairs.length) stimuli.set(id, pairs);
    }
  } else if (rawStimuli && typeof rawStimuli === "object") {
    for (const [rawId, rawItem] of Object.entries(rawStimuli)) {
      const id = safeText(rawId);
      if (!id) continue;
      const rawPairs = Array.isArray(rawItem?.pairs) ? rawItem.pairs : [];
      const pairs = rawPairs.map((pair) => normalizeConnectivityPair(pair)).filter(Boolean);
      if (pairs.length) stimuli.set(id, pairs);
    }
  }

  return { source_name, global_pairs: global_pairs, stimuli };
}

function applyConnectivityPairsToEdgeMap(pairs, edgeScaleMap) {
  if (!Array.isArray(pairs) || !pairs.length) return;

  for (const pair of pairs) {
    const fromIndices = labelToIndices.get(pair.from) || [];
    const toIndices = labelToIndices.get(pair.to) || [];
    if (!fromIndices.length || !toIndices.length) continue;

    for (const fromIdx of fromIndices) {
      for (const toIdx of toIndices) {
        if (fromIdx === toIdx) continue;
        const key = edgeKey(fromIdx, toIdx);
        if (!edgeKeySet.has(key)) continue;

        const prev = edgeScaleMap.get(key);
        if (
          prev === undefined ||
          Math.abs(pair.scale - 1) > Math.abs(prev - 1)
        ) {
          edgeScaleMap.set(key, pair.scale);
        }
      }
    }
  }
}

function buildConnectivityMaps(spec) {
  connectivityByStimulus.clear();
  if (!spec) return;

  const globalMap = new Map();
  applyConnectivityPairsToEdgeMap(spec.global_pairs, globalMap);
  if (globalMap.size) connectivityByStimulus.set("*", globalMap);

  for (const [stimulusId, pairs] of spec.stimuli.entries()) {
    const edgeScaleMap = new Map(globalMap);
    applyConnectivityPairsToEdgeMap(pairs, edgeScaleMap);
    if (edgeScaleMap.size) connectivityByStimulus.set(stimulusId, edgeScaleMap);
  }
}

function applyStimulusConnectivity(stimulusId) {
  const edgeScaleMap = (
    stimulusId && connectivityByStimulus.get(stimulusId)
  ) || connectivityByStimulus.get("*") || null;

  activeConnectivityMap = edgeScaleMap;
  activeConnectivityEdgeCount = edgeScaleMap ? edgeScaleMap.size : 0;

  for (let i = 0; i < adjacencyBase.length; i++) {
    const baseRow = adjacencyBase[i] || [];
    const activeRow = new Array(baseRow.length);
    for (let j = 0; j < baseRow.length; j++) {
      const nb = baseRow[j];
      const scale = edgeScaleMap ? (edgeScaleMap.get(edgeKey(i, nb.to)) || 1) : 1;
      activeRow[j] = {
        to: nb.to,
        w: THREE.MathUtils.clamp(nb.w * scale, 0.001, 1.0),
      };
    }
    adjacency[i] = activeRow;
  }

  updateConnectivityStatus();
}

function setActiveStimulus(stimulusId) {
  if (!stimulusLibrary || !Array.isArray(stimulusLibrary.stimuli)) return false;
  const next = stimulusLibrary.stimuli.find((s) => s.id === stimulusId) || null;
  if (!next) return false;
  activeStimulus = next;
  renderStimulusMeta(next);

  const hrf = stimulusLibrary?.hrf || DEFAULT_HRF;
  const peak = Math.max(0.1, Number(hrf.peak_s) || 6);
  const fall = Math.max(0.1, Number(hrf.fall_s) || 12);
  const travelWindowS = 7.0;
  state.durationS = peak + fall + travelWindowS;
  applyStimulusConnectivity(next.id);

  seedNodes = [];
  for (let i = 0; i < nodeArrival.length; i++) {
    nodeArrival[i] = Infinity;
    nodeRelevant[i] = false;
  }

  const resolvedSeeds = [];
  for (const seed of next.seed_regions || []) {
    resolvedSeeds.push(...expandSeedLabel(seed));
  }

  const seedIndices = [];
  for (const seed of resolvedSeeds) {
    const idx = labelToIndex.get(seed.aal_label);
    if (!Number.isInteger(idx)) continue;
    const w = Math.max(0, Number(seed.w) || 0);
    if (w <= 0) continue;
    seedIndices.push(idx);
    seedNodes.push({ idx, w, distances: dijkstraFrom(idx), maxDist: 1 });
  }

  const hasSeedNodes = seedNodes.length > 0;

  for (const s of seedNodes) {
    let maxD = 0;
    for (const d of s.distances) {
      if (Number.isFinite(d)) maxD = Math.max(maxD, d);
    }
    s.maxDist = Math.max(1, maxD);
  }

  pathEdgeKeys = new Set();
  pathParent = new Array(nodeArrival.length).fill(-1);
  reachableNodeCount = 0;

  if (seedIndices.length) {
    const model = buildMultiSourcePathModel(seedIndices);
    pathParent = model.parent;
    const engagement = next.engagement || DEFAULT_ENGAGEMENT;
    const breadthQ = THREE.MathUtils.clamp(Number(state.pathBreadthQ) || engagement.arrival_quantile, 0.60, 0.98);
    const finiteDistances = model.dist.filter((d) => Number.isFinite(d));
    const distanceCutoff = quantileCutoff(finiteDistances, breadthQ);
    const seedSet = new Set(seedIndices);

    let maxRelevantDist = 0;
    for (let i = 0; i < model.dist.length; i++) {
      const d = model.dist[i];
      const relevant = Number.isFinite(d) && (d <= distanceCutoff || seedSet.has(i));
      nodeRelevant[i] = relevant;
      if (relevant) maxRelevantDist = Math.max(maxRelevantDist, d);
    }

    const distNorm = Math.max(0.1, maxRelevantDist);
    for (let i = 0; i < model.dist.length; i++) {
      if (!nodeRelevant[i]) {
        nodeArrival[i] = Infinity;
        continue;
      }

      const d = model.dist[i];
      nodeArrival[i] = (d / distNorm) * travelWindowS;
      reachableNodeCount += 1;

      if (model.parent[i] >= 0 && nodeRelevant[model.parent[i]]) {
        pathEdgeKeys.add(edgeKey(i, model.parent[i]));
      }
    }

    for (const e of graph.edges) {
      const w = Number(e.weight_norm) || 0;
      if (w < engagement.edge_weight_min) continue;
      if (!nodeRelevant[e.source] || !nodeRelevant[e.target]) continue;
      const a = nodeArrival[e.source];
      const b = nodeArrival[e.target];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (Math.abs(a - b) <= engagement.coactivation_lag_s) {
        pathEdgeKeys.add(edgeKey(e.source, e.target));
      }
    }
  } else {
    for (let i = 0; i < nodeArrival.length; i++) nodeArrival[i] = Infinity;
  }

  rebuildEdges();
  state.t = 0;
  arrivalEventsCache = collectArrivalEvents();
  updateNarrationCursorFromTime();
  renderTimeline();
  setStatus(hasSeedNodes ? "ready" : `No graph seeds resolved for "${next.label}"`);
  applyActivationAtTime(state.t);
  refreshNarrationStatus();
  renderHud();
  return true;
}

function applyActivationAtTime(tSec) {
  if (!graph || !activeStimulus) return;

  const hrf = stimulusLibrary?.hrf || DEFAULT_HRF;
  const seedWindowS = 7.0;

  for (let i = 0; i < nodeActivation.length; i++) nodeActivation[i] = 0;

  for (const seed of seedNodes) {
    for (let i = 0; i < nodeActivation.length; i++) {
      if (!nodeRelevant[i]) continue;
      const d = seed.distances[i];
      if (!Number.isFinite(d)) continue;
      const dNorm = d / seed.maxDist;
      const arrival = dNorm * seedWindowS;
      const local = hrfEnvelopeAt(tSec - arrival, hrf);
      if (local <= 0) continue;
      const atten = Math.exp(-2.2 * dNorm);
      nodeActivation[i] += seed.w * atten * local;
    }
  }

  for (let i = 0; i < nodeActivation.length; i++) {
    nodeActivation[i] = clamp01(nodeActivation[i] * state.gain);
  }

  updateMajorRegionReadout();
  applyNodeStyle();
  updateEdgeColors();
  renderTimeline();
}

function play() {
  if (!activeStimulus) return;
  if (state.running && !state.paused) return;
  if (state.searchExploreOn) {
    clearSearchExplore();
    applyActivationAtTime(state.t);
  }
  state.running = true;
  state.paused = false;
  state.lastMs = performance.now();
  updateNarrationCursorFromTime();
  refreshNarrationStatus();
  setStatus("playing");
  emit("stimflow:play", {
    stimulus_id: activeStimulus.id,
    mode: state.mode,
    speed: state.speed,
    gain: state.gain,
    build_id: STIMFLOW_BUILD_ID,
  });
}

function pause() {
  if (!state.running) return;
  state.paused = true;
  refreshNarrationStatus();
  setStatus("paused");
  emit("stimflow:pause", {
    stimulus_id: activeStimulus?.id || null,
    t: state.t,
    build_id: STIMFLOW_BUILD_ID,
  });
}

function stop() {
  const priorT = state.t;
  state.running = false;
  state.paused = false;
  state.t = 0;
  updateNarrationCursorFromTime();
  stopNarration();
  setStatus("stopped");
  applyActivationAtTime(state.t);
  emit("stimflow:stop", {
    stimulus_id: activeStimulus?.id || null,
    t: priorT,
    build_id: STIMFLOW_BUILD_ID,
  });
}

function syncUI() {
  const resolvedMode = resolveLibraryMode(state.libraryMode);
  if (ui.basisSelect && resolvedMode) ui.basisSelect.value = resolvedMode;
  if (ui.graphSelect) ui.graphSelect.value = normalizeGraphMode(state.graphMode);
  ui.toggleEdges.checked = state.edgesOn;
  if (ui.togglePathOnly) ui.togglePathOnly.checked = state.pathOnly;
  if (ui.toggleReachedOnly) ui.toggleReachedOnly.checked = state.reachedOnly;
  if (ui.toggleRadiation) ui.toggleRadiation.checked = state.radiationOn;
  if (ui.toggleHoverGroup) ui.toggleHoverGroup.checked = state.hoverGroupOn;
  ui.toggleHull.checked = state.hullOn;
  if (ui.hullOpacityRange) ui.hullOpacityRange.value = state.hullOpacity.toFixed(2);
  if (ui.hullOpacityVal) ui.hullOpacityVal.textContent = state.hullOpacity.toFixed(2);
  ui.toggleAuto.checked = state.autoRotate;
  ui.edgeThresh.value = String(state.edgeThreshold);
  ui.edgeVal.textContent = state.edgeThreshold.toFixed(2);

  ui.speedRange.value = String(state.speed);
  ui.speedVal.textContent = `${state.speed.toFixed(2)}x`;
  updateStepControls();
  if (ui.toggleNarration) ui.toggleNarration.checked = state.narrationOn;
  if (ui.narrationRateRange) ui.narrationRateRange.value = state.narrationRate.toFixed(2);
  if (ui.narrationRateVal) ui.narrationRateVal.textContent = `${state.narrationRate.toFixed(2)}x`;
  refreshNarrationStatus();
  ui.gainRange.value = String(state.gain);
  ui.gainVal.textContent = state.gain.toFixed(2);
  if (ui.breadthRange) ui.breadthRange.value = state.pathBreadthQ.toFixed(2);
  if (ui.breadthVal) ui.breadthVal.textContent = state.pathBreadthQ.toFixed(2);
  ui.modeSelect.value = state.mode;
  setUIMode(state.uiMode);
  setExportStatus("ready");
  updateGraphStatus();
  updateConnectivityStatus();
  if (!regionSearchQuery) resetRegionSearchStatus();
}

function applyHullOpacity(value) {
  const nextOpacity = THREE.MathUtils.clamp(Number(value), HULL_OPACITY_MIN, HULL_OPACITY_MAX);
  state.hullOpacity = Number.isFinite(nextOpacity) ? nextOpacity : HULL_OPACITY;
  if (ui.hullOpacityRange) ui.hullOpacityRange.value = state.hullOpacity.toFixed(2);
  if (ui.hullOpacityVal) ui.hullOpacityVal.textContent = state.hullOpacity.toFixed(2);

  if (!hullGroup) return;
  hullGroup.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    child.material.transparent = true;
    child.material.opacity = state.hullOpacity;
    child.material.needsUpdate = true;
  });
}

window.addEventListener("keydown", (ev) => {
  if (isTextEntryTarget(ev.target)) return;

  if (ev.key === "Escape") clearSelection();
  if (ev.code === "Space") {
    ev.preventDefault();
    if (!state.running || state.paused) play();
    else pause();
  }
  if (ev.code === "ArrowLeft") {
    ev.preventDefault();
    if (ev.shiftKey) jumpToArrival(-1);
    else setTimelinePosition(state.t - state.scrubStepS, "step_back");
  }
  if (ev.code === "ArrowRight") {
    ev.preventDefault();
    if (ev.shiftKey) jumpToArrival(1);
    else setTimelinePosition(state.t + state.scrubStepS, "step_forward");
  }
});

ui.btnPlay.addEventListener("click", () => play());
ui.btnPause.addEventListener("click", () => pause());
ui.btnStop.addEventListener("click", () => stop());
if (ui.btnStepBack) {
  ui.btnStepBack.addEventListener("click", () => {
    setTimelinePosition(state.t - state.scrubStepS, "step_back");
  });
}
if (ui.btnStepForward) {
  ui.btnStepForward.addEventListener("click", () => {
    setTimelinePosition(state.t + state.scrubStepS, "step_forward");
  });
}
if (ui.btnPrevArrival) {
  ui.btnPrevArrival.addEventListener("click", () => {
    jumpToArrival(-1);
  });
}
if (ui.btnNextArrival) {
  ui.btnNextArrival.addEventListener("click", () => {
    jumpToArrival(1);
  });
}
if (ui.btnExportJson) ui.btnExportJson.addEventListener("click", () => exportPathReportJson());
if (ui.btnExportCsv) ui.btnExportCsv.addEventListener("click", () => exportPathReportCsv());
if (ui.btnRegionSearch && ui.regionSearchInput) {
  ui.btnRegionSearch.addEventListener("click", () => {
    rebuildRegionSearch(ui.regionSearchInput.value);
  });
}
if (ui.btnRegionPrev) {
  ui.btnRegionPrev.addEventListener("click", () => {
    cycleRegionSearch(-1);
  });
}
if (ui.btnRegionNext) {
  ui.btnRegionNext.addEventListener("click", () => {
    cycleRegionSearch(1);
  });
}
if (ui.regionSearchSuggest) {
  ui.regionSearchSuggest.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button.item");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (!Number.isInteger(idx)) return;
    acceptRegionSuggestion(idx);
  });
}
if (ui.regionSearchInput) {
  ui.regionSearchInput.addEventListener("input", () => {
    const normalized = normalizeSearchText(ui.regionSearchInput.value);
    if (!normalized) {
      regionSearchQuery = "";
      regionSearchMatches = [];
      regionSearchCursor = -1;
      clearSearchExplore();
      resetRegionSearchStatus();
      applyActivationAtTime(state.t);
    }
    updateRegionAutocomplete(ui.regionSearchInput.value);
  });
  ui.regionSearchInput.addEventListener("focus", () => {
    updateRegionAutocomplete(ui.regionSearchInput.value);
  });
  ui.regionSearchInput.addEventListener("blur", () => {
    // Delay so click on suggestion can register before hide.
    setTimeout(() => hideRegionSearchSuggest(), 120);
  });
  ui.regionSearchInput.addEventListener("keydown", (ev) => {
    const suggestOpen = Boolean(regionSuggestEntries.length && ui.regionSearchSuggest && !ui.regionSearchSuggest.hidden);

    if (ev.key === "ArrowDown" && suggestOpen) {
      ev.preventDefault();
      regionSuggestCursor = (regionSuggestCursor + 1 + regionSuggestEntries.length) % regionSuggestEntries.length;
      renderRegionSearchSuggest(regionSuggestEntries, regionSuggestCursor);
      return;
    }

    if (ev.key === "ArrowUp" && suggestOpen) {
      ev.preventDefault();
      regionSuggestCursor = (regionSuggestCursor - 1 + regionSuggestEntries.length) % regionSuggestEntries.length;
      renderRegionSearchSuggest(regionSuggestEntries, regionSuggestCursor);
      return;
    }

    if (ev.key === "Escape" && suggestOpen) {
      ev.preventDefault();
      hideRegionSearchSuggest();
      return;
    }

    if (ev.key === "Enter") {
      ev.preventDefault();
      if (suggestOpen && regionSuggestCursor >= 0) {
        acceptRegionSuggestion(regionSuggestCursor);
      } else {
        rebuildRegionSearch(ui.regionSearchInput.value);
      }
    }
  });
}

ui.modeSelect.addEventListener("change", () => {
  state.mode = ui.modeSelect.value === "once" ? "once" : "loop";
});

if (ui.uiModeSelect) {
  ui.uiModeSelect.addEventListener("change", () => {
    setUIMode(ui.uiModeSelect.value);
  });
}

ui.speedRange.addEventListener("input", () => {
  state.speed = Number(ui.speedRange.value) || 1;
  ui.speedVal.textContent = `${state.speed.toFixed(2)}x`;
});

if (ui.scrubRange) {
  ui.scrubRange.addEventListener("input", () => {
    setTimelinePosition(ui.scrubRange.value, "scrub");
  });
}

if (ui.scrubRateRange) {
  ui.scrubRateRange.addEventListener("input", () => {
    state.scrubStepS = THREE.MathUtils.clamp(Number(ui.scrubRateRange.value) || DEFAULT_SCRUB_STEP_S, 0.1, 2.0);
    updateStepControls();
  });
}

if (ui.toggleNarration) {
  ui.toggleNarration.addEventListener("change", () => {
    state.narrationOn = ui.toggleNarration.checked;
    if (!state.narrationOn) {
      stopNarration();
      refreshNarrationStatus();
    } else {
      refreshNarrationStatus();
    }
  });
}

if (ui.narrationRateRange) {
  ui.narrationRateRange.addEventListener("input", () => {
    state.narrationRate = THREE.MathUtils.clamp(Number(ui.narrationRateRange.value) || 1, 0.6, 1.8);
    if (ui.narrationRateVal) ui.narrationRateVal.textContent = `${state.narrationRate.toFixed(2)}x`;
    refreshNarrationStatus();
  });
}

if (ui.btnNarrateNow) {
  ui.btnNarrateNow.addEventListener("click", () => {
    narrateNextArrival(true);
  });
}

if (ui.btnNarrationMute) {
  ui.btnNarrationMute.addEventListener("click", () => {
    stopNarration();
  });
}

ui.gainRange.addEventListener("input", () => {
  state.gain = Number(ui.gainRange.value) || 1;
  ui.gainVal.textContent = state.gain.toFixed(2);
  applyActivationAtTime(state.t);
});

if (ui.breadthRange) {
  ui.breadthRange.addEventListener("input", () => {
    state.pathBreadthQ = THREE.MathUtils.clamp(Number(ui.breadthRange.value) || DEFAULT_ENGAGEMENT.arrival_quantile, 0.60, 0.98);
    if (ui.breadthVal) ui.breadthVal.textContent = state.pathBreadthQ.toFixed(2);
    if (activeStimulus) {
      const activeId = activeStimulus.id;
      const wasRunning = state.running && !state.paused;
      setActiveStimulus(activeId);
      if (wasRunning) play();
      else renderHud();
    }
  });
}

ui.stimSelect.addEventListener("change", () => {
  const id = ui.stimSelect.value;
  const ok = setActiveStimulus(id);
  if (!ok) {
    setStatus(`missing stimulus "${id}"`);
    return;
  }
  if (state.running && !state.paused) {
    state.t = 0;
    state.lastMs = performance.now();
    emit("stimflow:play", {
      stimulus_id: activeStimulus.id,
      mode: state.mode,
      speed: state.speed,
      gain: state.gain,
      build_id: STIMFLOW_BUILD_ID,
    });
  }
});

if (ui.basisSelect) {
  ui.basisSelect.addEventListener("change", () => {
    const keepStimulusId = ui.stimSelect.value || activeStimulus?.id || "";
    setActiveLibrary(ui.basisSelect.value, keepStimulusId);
    if (state.running && !state.paused) {
      state.t = 0;
      state.lastMs = performance.now();
    }
    renderHud();
  });
}

if (ui.graphSelect) {
  ui.graphSelect.addEventListener("change", () => {
    const mode = normalizeGraphMode(ui.graphSelect.value);
    const url = new URL(window.location.href);
    url.searchParams.set("graph_mode", mode);
    url.searchParams.set("path_breadth_q", state.pathBreadthQ.toFixed(2));
    window.location.href = url.toString();
  });
}

ui.toggleEdges.addEventListener("change", () => {
  state.edgesOn = ui.toggleEdges.checked;
  rebuildEdges();
});

if (ui.togglePathOnly) {
  ui.togglePathOnly.addEventListener("change", () => {
    state.pathOnly = ui.togglePathOnly.checked;
    rebuildEdges();
  });
}

if (ui.toggleReachedOnly) {
  ui.toggleReachedOnly.addEventListener("change", () => {
    state.reachedOnly = ui.toggleReachedOnly.checked;
    applyActivationAtTime(state.t);
    renderHud();
  });
}

if (ui.toggleRadiation) {
  ui.toggleRadiation.addEventListener("change", () => {
    state.radiationOn = ui.toggleRadiation.checked;
    if (nodeHaloMesh) nodeHaloMesh.visible = state.radiationOn;
    applyActivationAtTime(state.t);
    renderHud();
  });
}

if (ui.toggleHoverGroup) {
  ui.toggleHoverGroup.addEventListener("change", () => {
    state.hoverGroupOn = ui.toggleHoverGroup.checked;
    updateHoverGroup();
    applyNodeStyle();
    renderHud();
  });
}

ui.toggleHull.addEventListener("change", () => {
  state.hullOn = ui.toggleHull.checked;
  if (hullGroup) hullGroup.visible = state.hullOn;
  renderHud();
});

if (ui.hullOpacityRange) {
  ui.hullOpacityRange.addEventListener("input", () => {
    applyHullOpacity(ui.hullOpacityRange.value);
    renderHud();
  });
}

ui.toggleAuto.addEventListener("change", () => {
  setAutoRotateEnabled(ui.toggleAuto.checked, true);
  renderHud();
});

ui.edgeThresh.addEventListener("input", () => {
  state.edgeThreshold = Number(ui.edgeThresh.value) || 0;
  ui.edgeVal.textContent = state.edgeThreshold.toFixed(2);
  rebuildEdges();
});

ui.btnReset.addEventListener("click", () => {
  controls.reset();
  renderHud();
});

function animate(nowMs) {
  requestAnimationFrame(animate);

  if (state.running && !state.paused) {
    if (!state.lastMs) state.lastMs = nowMs;
    const dt = Math.max(0, (nowMs - state.lastMs) / 1000);
    state.lastMs = nowMs;
    const prevT = state.t;
    state.t += dt * state.speed;

    const finished = state.t >= state.durationS;
    let loopRestarted = false;
    if (finished) {
      if (state.mode === "loop") {
        state.t = 0;
        loopRestarted = true;
        updateNarrationCursorFromTime();
      } else {
        state.t = state.durationS;
        state.running = false;
        state.paused = false;
        setStatus("completed");
      }
    }

    applyActivationAtTime(state.t);
    if (!loopRestarted) narrateProgress(prevT, state.t);
    if (loopRestarted && state.narrationOn) {
      refreshNarrationStatus("Narration: loop restart");
    }
    emit("stimflow:frame", {
      stimulus_id: activeStimulus?.id || null,
      t: state.t,
      speed: state.speed,
      gain: state.gain,
      build_id: STIMFLOW_BUILD_ID,
    });
  }

  if (!state.autoRotate) {
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0;
  }
  controls.update();
  renderer.render(scene, camera);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

async function loadGraph() {
  const mode = normalizeGraphMode(state.graphMode);
  if (mode === "core") {
    return await fetchJson(GRAPH_URL, "aal_graph.json");
  }

  if (mode === "dense") {
    try {
      return await fetchJson(GRAPH_DENSE_URL, "aal_graph_dense.json");
    } catch (err) {
      console.warn("Dense graph unavailable, falling back to core graph:", err);
      return await fetchJson(GRAPH_URL, "aal_graph.json");
    }
  }

  try {
    return await fetchJson(GRAPH_DENSE_URL, "aal_graph_dense.json");
  } catch (err) {
    console.warn("Dense graph unavailable, falling back to core graph:", err);
    return await fetchJson(GRAPH_URL, "aal_graph.json");
  }
}

async function fetchJson(url, label) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${label} HTTP ${r.status}`);
  return await r.json();
}

async function loadHullObj() {
  const loader = new OBJLoader();
  return await loader.loadAsync(HULL_URL);
}

async function loadTemplateStimulusLibrary() {
  try {
    const fromLibrary = await fetchJson(STIMULI_LIBRARY_URL, "stimuli.library.json");
    return normalizeStimulusLibrary(fromLibrary, "stimuli.library.json");
  } catch (err) {
    console.warn("Stimulus library load failed, falling back to template:", err);
  }

  const fromTemplate = await fetchJson(STIMULI_TEMPLATE_URL, "stimuli.template.json");
  return normalizeStimulusLibrary(fromTemplate, "stimuli.template.json");
}

async function loadEmpiricalStimulusLibrary() {
  const raw = await fetchJson(STIMULI_EMPIRICAL_URL, "stimuli.empirical.json");
  return normalizeStimulusLibrary(raw, "stimuli.empirical.json");
}

async function loadStimulusLibraries() {
  const libs = { template: null, empirical: null };

  try {
    libs.empirical = await loadEmpiricalStimulusLibrary();
  } catch (err) {
    console.warn("Empirical stimulus library unavailable:", err);
  }

  try {
    libs.template = await loadTemplateStimulusLibrary();
  } catch (err) {
    console.warn("Template stimulus library unavailable:", err);
  }

  if (!libs.empirical && !libs.template) {
    throw new Error("No valid stimulus libraries available");
  }

  return libs;
}

async function loadConnectivitySpec() {
  connectivitySourceName = "";
  connectivitySpec = null;
  connectivityByStimulus.clear();
  activeConnectivityMap = null;
  activeConnectivityEdgeCount = 0;
  updateConnectivityStatus();

  try {
    const raw = await fetchJson(CONNECTIVITY_EMPIRICAL_URL, "connectivity.empirical.json");
    const spec = normalizeConnectivitySpec(raw);
    connectivitySpec = spec;
    buildConnectivityMaps(spec);
    connectivitySourceName = spec.source_name;
  } catch (err) {
    console.warn("Connectivity matrix unavailable; using baseline graph weights:", err);
    connectivitySourceName = "graph-only";
  }

  applyStimulusConnectivity(activeStimulus?.id || null);
  updateConnectivityStatus();
}

async function loadRegionCards() {
  try {
    regionCards = await fetchJson(REGION_CARDS_URL, "aal_region_cards.json");
    regionCardLookup.clear();
    const cards = regionCards?.cards || {};
    for (const [label, card] of Object.entries(cards)) {
      regionCardLookup.set(label, card);
      const canonical = resolveAalAlias(label);
      regionCardLookup.set(canonical, card);

      const legacy = CARD_LABEL_ALIASES.get(label) || CARD_LABEL_ALIASES.get(canonical);
      if (legacy) regionCardLookup.set(legacy, card);

      if (Array.isArray(card.aliases)) {
        for (const alias of card.aliases) {
          if (alias) regionCardLookup.set(alias, card);
        }
      }
    }
  } catch (err) {
    console.warn("Region cards load failed:", err);
    regionCards = null;
    regionCardLookup.clear();
  }
}

const STIMULUS_GROUP_ORDER = [
  "Clinical Medications (ED/ICU/Med-Surg)",
  "Sensory and Motor",
  "Pain and Somatosensory",
  "Emotion and Threat",
  "Reward and Motivation",
  "Learning, Memory, and Sleep",
  "Drugs and Substance Effects",
  "Other Educational Stimuli",
];

function classifyStimulusGroup(stim) {
  const id = safeText(stim?.id).toLowerCase();
  const label = safeText(stim?.label).toLowerCase();
  const evidence = safeText(stim?.evidence_type).toLowerCase();
  const text = `${id} ${label} ${evidence}`;

  if (text.includes("inpatient medication template")) {
    return "Clinical Medications (ED/ICU/Med-Surg)";
  }

  if (
    /(morphine|fentanyl|hydromorphone|oxycodone|ketorolac|ondansetron|metoclopramide|pantoprazole|enoxaparin|heparin|insulin|metoprolol|labetalol|furosemide|ceftriaxone|vancomycin|piperacillin|albuterol|ipratropium|dexamethasone|lorazepam|propofol|norepinephrine|acetaminophen|losartan|clonazepam|klonopin)/.test(text)
  ) {
    return "Clinical Medications (ED/ICU/Med-Surg)";
  }

  if (/(pain|pinprick|nocicept|somatosensory|analgesi)/.test(text)) {
    return "Pain and Somatosensory";
  }

  if (/(fear|threat|anx|stress|salience)/.test(text)) {
    return "Emotion and Threat";
  }

  if (/(reward|surprise|motivat|dopamin)/.test(text)) {
    return "Reward and Motivation";
  }

  if (/(learning|memory|sleep|wake|consolidat)/.test(text)) {
    return "Learning, Memory, and Sleep";
  }

  if (/(music|auditory|hearing|visual|motor|tapping|language|speech)/.test(text)) {
    return "Sensory and Motor";
  }

  if (/(psilocybin|hallucin|lsd|cannabis|thc|alcohol|nicotine|caffeine|drug|substance)/.test(text)) {
    return "Drugs and Substance Effects";
  }

  return "Other Educational Stimuli";
}

function populateStimuliSelect(preferredId = "") {
  if (!stimulusLibrary) return;
  ui.stimSelect.innerHTML = "";

  const grouped = new Map();
  for (const groupName of STIMULUS_GROUP_ORDER) grouped.set(groupName, []);

  for (const stim of stimulusLibrary.stimuli || []) {
    const groupName = classifyStimulusGroup(stim);
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName).push(stim);
  }

  for (const groupName of STIMULUS_GROUP_ORDER) {
    const items = grouped.get(groupName) || [];
    if (!items.length) continue;

    const optgroup = document.createElement("optgroup");
    optgroup.label = groupName;

    items.sort((a, b) => safeText(a.label).localeCompare(safeText(b.label)));
    for (const stim of items) {
      const opt = document.createElement("option");
      opt.value = stim.id;
      opt.textContent = stim.label;
      optgroup.appendChild(opt);
    }
    ui.stimSelect.appendChild(optgroup);
  }

  const ids = (stimulusLibrary.stimuli || []).map((s) => s.id);
  const candidates = [
    preferredId,
    activeStimulus?.id || "",
    "music",
    ids[0] || "",
  ];
  const defaultId = candidates.find((id) => id && ids.includes(id)) || "";
  if (defaultId) {
    ui.stimSelect.value = defaultId;
    setActiveStimulus(defaultId);
  }
}

function setActiveLibrary(preferredMode, preferredStimulusId = "") {
  const mode = resolveLibraryMode(preferredMode);
  if (!mode) {
    throw new Error("No stimulus library available");
  }

  state.libraryMode = mode;
  stimulusLibrary = stimulusLibraries[mode];
  if (ui.basisSelect) ui.basisSelect.value = mode;
  updateBasisStatus();
  setExportStatus("ready");
  populateStimuliSelect(preferredStimulusId);
  emit("stimflow:library-change", {
    basis: mode,
    source_name: stimulusLibrary?.source_name || "unknown",
    build_id: STIMFLOW_BUILD_ID,
  });
}

syncUI();
setAutoRotateEnabled(state.autoRotate, false);
renderTimeline();
renderHud();
requestAnimationFrame(animate);

(async () => {
  try {
    hud(`${MILESTONE_LABEL}\nPreparing brain map...`);
    graph = await loadGraph();
    addNodes(graph);
    rebuildEdges();

    hud(`${MILESTONE_LABEL}\nLoading region notes...`);
    await loadRegionCards();

    hud(`${MILESTONE_LABEL}\nLoading scenarios...`);
    stimulusLibraries = await loadStimulusLibraries();

    hud(`${MILESTONE_LABEL}\nPreparing network pathways...`);
    await loadConnectivitySpec();

    setActiveLibrary(state.libraryMode, "music");

    hud(`${MILESTONE_LABEL}\nLoading cortex layer...`);
    try {
      const hullObj = await loadHullObj();
      addHull(hullObj);
    } catch (e) {
      console.warn("Cortex layer load failed:", e);
    }

    applyActivationAtTime(state.t);
    renderHud();
    play();
  } catch (e) {
    console.error(e);
    hud(`${MILESTONE_LABEL}\nUnable to load viewer\n${e.message}`, true);
    setStatus("error");
  }
})();
