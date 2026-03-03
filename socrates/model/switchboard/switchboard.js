import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const CORE_BUILD_ID = "1771549511";
const SWITCHBOARD_BUILD_ID = "seed-only-init";
const CACHE_BUST = `${CORE_BUILD_ID}-${SWITCHBOARD_BUILD_ID}`;

function prettyAalLabel(raw) {
  if (!raw) return "";

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

function emitSwitchboardEvent(type, detail) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

const buildEl = document.getElementById("build");
const hudEl = document.getElementById("hud");

const ui = {
  toggleEdges: document.getElementById("toggleEdges"),
  toggleHull: document.getElementById("toggleHull"),
  toggleAuto: document.getElementById("toggleAuto"),
  btnReset: document.getElementById("btnReset"),
  edgeThresh: document.getElementById("edgeThresh"),
  edgeVal: document.getElementById("edgeVal"),
  sbCollapse: document.getElementById("sbCollapse"),
  sbWrap: document.getElementById("switchboard"),
  sbPlay: document.getElementById("sbPlay"),
  sbStop: document.getElementById("sbStop"),
  sbStimulus: document.getElementById("sbStimulus"),
  sbTier: document.getElementById("sbTier"),
  sbExplain: document.getElementById("sbExplain"),
  sbTime: document.getElementById("sbTime"),
  sbEnvelope: document.getElementById("sbEnvelope"),
  sbStatus: document.getElementById("sbStatus"),
};

function hud(msg, isError = false) {
  hudEl.textContent = msg;
  hudEl.classList.toggle("error", isError);
}

buildEl.textContent = `model - SWITCHBOARD BUILD ${SWITCHBOARD_BUILD_ID} - CORE ${CORE_BUILD_ID}`;

const state = {
  edgesOn: true,
  hullOn: true,
  autoRotate: true,
  edgeThreshold: 0.08,
  switchboard: {
    running: false,
    t: 0,
    envelope: 0,
    startMs: 0,
    durationS: 18,
    hrf: { rise_s: 4, peak_s: 6, fall_s: 12 },
    stimulus: null,
    resolvedSeeds: [],
    unresolvedSeeds: [],
  },
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(0, 1.2, 2.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotateSpeed = 1.4;
controls.target.set(0, 0.2, 0);
controls.update();
controls.saveState();

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(2, 3, 2);
scene.add(dir);

const SCALE = 0.01;
function mniToThree([x, y, z]) {
  return new THREE.Vector3(x * SCALE, z * SCALE, -y * SCALE);
}

const GRAPH_URL = `../assets/aal_graph.json?v=${CACHE_BUST}`;
const HULL_URL = `../assets/brain_hull.obj?v=${CACHE_BUST}`;
const STIMULI_URL = `./stimuli.template.json?v=${CACHE_BUST}`;

let graph = null;
let nodeMesh = null;
let hullGroup = null;
let edgeLines = null;
let edgeHighlightLines = null;
let edgesFiltered = [];
let edgesShown = 0;
let hoveredIdx = null;
let selectedIdx = null;
let selectedNeighbors = new Set();

const nodeBase = [];
const nodeActivation = [];
const labelToIndex = new Map();
const dummy = new THREE.Object3D();
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const SELECT_COLOR = new THREE.Color(0xffe066);
const NEIGH_COLOR = new THREE.Color(0x9dffb0);
const ACTIVE_COLOR = new THREE.Color(0xff8a33);

function updateMouseFromEvent(ev) {
  mouse.x = (ev.clientX / innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / innerHeight) * 2 + 1;
}

function renderHud() {
  if (!graph) {
    hud(`SWITCHBOARD BUILD ${SWITCHBOARD_BUILD_ID}\nLoading...`);
    return;
  }

  const lines = [];
  lines.push(`SWITCHBOARD BUILD ${SWITCHBOARD_BUILD_ID}`);
  lines.push(`Nodes: ${graph.nodes.length} | Edges shown: ${edgesShown}`);
  lines.push(`Edge threshold: ${state.edgeThreshold.toFixed(2)} | Edges ${state.edgesOn ? "ON" : "OFF"} | Hull ${state.hullOn ? "ON" : "OFF"} | Auto ${state.autoRotate ? "ON" : "OFF"}`);
  lines.push(`Switchboard: ${state.switchboard.running ? "RUN" : "IDLE"} | t=${state.switchboard.t.toFixed(2)}s | A=${state.switchboard.envelope.toFixed(2)}`);

  if (selectedIdx !== null) {
    const n = graph.nodes[selectedIdx];
    lines.push(`Selected: ${prettyAalLabel(n.name)}  (${selectedNeighbors.size} neighbors)`);
    lines.push("Tip: click empty space or press Esc to clear");
  } else {
    lines.push("Selected: none (click a node to select)");
  }

  if (hoveredIdx !== null) {
    const h = graph.nodes[hoveredIdx];
    lines.push(`Hover: ${prettyAalLabel(h.name)}`);
  } else {
    lines.push("Hover: none");
  }

  hud(lines.join("\n"));
}

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

  for (let i = 0; i < graph.nodes.length; i++) {
    const base = nodeBase[i];
    let scale = base.baseScale;
    let color = base.baseColor.clone();

    if (selectedIdx !== null) {
      if (i === selectedIdx) {
        scale = base.baseScale * 1.7;
        color = SELECT_COLOR.clone();
      } else if (selectedNeighbors.has(i)) {
        scale = base.baseScale * 1.25;
        color = NEIGH_COLOR.clone();
      } else {
        color.multiplyScalar(0.25);
      }
    }

    const act = nodeActivation[i] || 0;
    if (act > 0) {
      const t = THREE.MathUtils.clamp(act, 0, 1);
      color.lerp(ACTIVE_COLOR, 0.25 + 0.75 * t);
      scale *= 1 + (0.9 * t);
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

function rebuildEdges() {
  if (!graph) return;

  edgesFiltered = graph.edges.filter((e) => (e.weight_norm ?? 0) >= state.edgeThreshold);
  removeLines("base");

  if (!state.edgesOn) {
    edgesShown = 0;
    rebuildEdgeHighlight();
    applyNodeStyle();
    renderHud();
    return;
  }

  edgesShown = edgesFiltered.length;

  const positions = new Float32Array(edgesFiltered.length * 6);
  for (let k = 0; k < edgesFiltered.length; k++) {
    const e = edgesFiltered[k];
    const a = mniToThree(graph.nodes[e.source].mni_mm);
    const b = mniToThree(graph.nodes[e.target].mni_mm);
    const base = k * 6;
    positions[base + 0] = a.x;
    positions[base + 1] = a.y;
    positions[base + 2] = a.z;
    positions[base + 3] = b.x;
    positions[base + 4] = b.y;
    positions[base + 5] = b.z;
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

  const incident = edgesFiltered.filter((e) => e.source === selectedIdx || e.target === selectedIdx);
  if (!incident.length) return;

  const positions = new Float32Array(incident.length * 6);
  for (let k = 0; k < incident.length; k++) {
    const e = incident[k];
    const a = mniToThree(graph.nodes[e.source].mni_mm);
    const b = mniToThree(graph.nodes[e.target].mni_mm);
    const base = k * 6;
    positions[base + 0] = a.x;
    positions[base + 1] = a.y;
    positions[base + 2] = a.z;
    positions[base + 3] = b.x;
    positions[base + 4] = b.y;
    positions[base + 5] = b.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.LineBasicMaterial({ color: 0xffffcc, transparent: true, opacity: 0.9 });
  edgeHighlightLines = new THREE.LineSegments(geo, mat);
  scene.add(edgeHighlightLines);
}

async function loadGraph() {
  const r = await fetch(GRAPH_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`aal_graph.json HTTP ${r.status}`);
  return await r.json();
}

async function loadHullObj() {
  const loader = new OBJLoader();
  return await loader.loadAsync(HULL_URL);
}

async function loadStimuliTemplate() {
  const r = await fetch(STIMULI_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`stimuli.template.json HTTP ${r.status}`);
  return await r.json();
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

    nodeBase[i] = { pos, baseScale, baseColor: c.clone() };
    nodeActivation[i] = 0;
    labelToIndex.set(n.name, i);

    dummy.position.copy(pos);
    dummy.scale.setScalar(baseScale);
    dummy.updateMatrix();
    nodeMesh.setMatrixAt(i, dummy.matrix);
    nodeMesh.setColorAt(i, c);
  }

  nodeMesh.instanceColor.needsUpdate = true;
  scene.add(nodeMesh);

  window.addEventListener("pointermove", (ev) => {
    updateMouseFromEvent(ev);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(nodeMesh);
    hoveredIdx = hits.length ? hits[0].instanceId : null;
    renderHud();
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

function normalizeHrf(raw) {
  const rise = Number(raw?.rise_s) || 4;
  const peak = Number(raw?.peak_s) || 6;
  const fall = Number(raw?.fall_s) || 12;
  return {
    rise_s: Math.max(0.1, rise),
    peak_s: Math.max(Math.max(0.1, rise), peak),
    fall_s: Math.max(0.1, fall),
  };
}

function hrfEnvelopeAt(t) {
  const rise = state.switchboard.hrf.rise_s;
  const peak = state.switchboard.hrf.peak_s;
  const fall = state.switchboard.hrf.fall_s;
  const end = peak + fall;

  if (t <= 0) return 0;
  if (t < rise) return t / rise;
  if (t < peak) return 1;
  if (t < end) return 1 - ((t - peak) / fall);
  return 0;
}

function setActivationAtTime(t) {
  state.switchboard.t = t;
  state.switchboard.envelope = hrfEnvelopeAt(t);

  for (let i = 0; i < nodeActivation.length; i++) {
    nodeActivation[i] = 0;
  }

  for (const seed of state.switchboard.resolvedSeeds) {
    nodeActivation[seed.index] = Math.max(
      nodeActivation[seed.index],
      seed.weight * state.switchboard.envelope
    );
  }

  applyNodeStyle();
  ui.sbTime.textContent = state.switchboard.t.toFixed(2);
  ui.sbEnvelope.textContent = state.switchboard.envelope.toFixed(2);
  renderHud();
}

function stopSwitchboard(reason = "manual_stop") {
  const wasRunning = state.switchboard.running;
  const priorT = state.switchboard.t;
  state.switchboard.running = false;
  state.switchboard.startMs = 0;
  setActivationAtTime(0);
  ui.sbStatus.textContent = `Status: ${reason}`;

  if (wasRunning) {
    emitSwitchboardEvent("switchboard:stop", {
      stimulus_id: state.switchboard.stimulus?.id || null,
      reason,
      t: priorT,
      build_id: SWITCHBOARD_BUILD_ID,
    });
  }
}

function playSwitchboard() {
  if (!state.switchboard.stimulus || !state.switchboard.resolvedSeeds.length) {
    ui.sbStatus.textContent = "Status: no playable stimulus seeds";
    return;
  }

  state.switchboard.running = true;
  state.switchboard.startMs = performance.now();
  setActivationAtTime(0);
  ui.sbStatus.textContent = "Status: running";

  emitSwitchboardEvent("switchboard:play", {
    stimulus_id: state.switchboard.stimulus.id,
    seed_count: state.switchboard.resolvedSeeds.length,
    tier: state.switchboard.stimulus.tier,
    build_id: SWITCHBOARD_BUILD_ID,
  });
}

function configureMusicStimulus(stimuliTemplate) {
  state.switchboard.hrf = normalizeHrf(stimuliTemplate?.hrf);
  state.switchboard.durationS = state.switchboard.hrf.peak_s + state.switchboard.hrf.fall_s;

  const music = Array.isArray(stimuliTemplate?.stimuli)
    ? stimuliTemplate.stimuli.find((s) => s.id === "music")
    : null;

  if (!music) {
    throw new Error("Music stimulus not found in stimuli.template.json");
  }

  state.switchboard.stimulus = music;
  state.switchboard.resolvedSeeds = [];
  state.switchboard.unresolvedSeeds = [];

  for (const seed of music.seed_regions || []) {
    const index = labelToIndex.get(seed.aal_label);
    if (Number.isInteger(index)) {
      state.switchboard.resolvedSeeds.push({
        index,
        label: seed.aal_label,
        weight: Number(seed.w) || 0,
      });
    } else {
      state.switchboard.unresolvedSeeds.push(seed.aal_label);
    }
  }

  ui.sbStimulus.textContent = `Stimulus: ${music.label}`;
  ui.sbTier.textContent = `Truth tier: ${music.tier}`;
  ui.sbExplain.textContent = "Simplified educational summary of seeded regional activation. Edges represent abstract coupling and are not literal axons.";
  ui.sbStatus.textContent = `Status: ready (${state.switchboard.resolvedSeeds.length} seed regions)`;

  if (state.switchboard.unresolvedSeeds.length) {
    ui.sbStatus.textContent += ` | unresolved: ${state.switchboard.unresolvedSeeds.join(", ")}`;
  }
}

window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") clearSelection();
});

function syncUI() {
  ui.toggleEdges.checked = state.edgesOn;
  ui.toggleHull.checked = state.hullOn;
  ui.toggleAuto.checked = state.autoRotate;
  ui.edgeThresh.value = String(state.edgeThreshold);
  ui.edgeVal.textContent = state.edgeThreshold.toFixed(2);
  ui.sbTime.textContent = state.switchboard.t.toFixed(2);
  ui.sbEnvelope.textContent = state.switchboard.envelope.toFixed(2);
}

ui.toggleEdges.addEventListener("change", () => {
  state.edgesOn = ui.toggleEdges.checked;
  rebuildEdges();
});

ui.toggleHull.addEventListener("change", () => {
  state.hullOn = ui.toggleHull.checked;
  if (hullGroup) hullGroup.visible = state.hullOn;
  renderHud();
});

ui.toggleAuto.addEventListener("change", () => {
  state.autoRotate = ui.toggleAuto.checked;
  controls.autoRotate = state.autoRotate;
  renderHud();
});

ui.edgeThresh.addEventListener("input", () => {
  state.edgeThreshold = parseFloat(ui.edgeThresh.value);
  ui.edgeVal.textContent = state.edgeThreshold.toFixed(2);
  rebuildEdges();
});

ui.btnReset.addEventListener("click", () => {
  controls.reset();
  renderHud();
});

ui.sbCollapse.addEventListener("click", () => {
  ui.sbWrap.classList.toggle("collapsed");
  ui.sbCollapse.textContent = ui.sbWrap.classList.contains("collapsed") ? "Expand" : "Collapse";
});

ui.sbPlay.addEventListener("click", () => {
  playSwitchboard();
});

ui.sbStop.addEventListener("click", () => {
  stopSwitchboard("manual_stop");
});

syncUI();
renderHud();

function animate(nowMs) {
  requestAnimationFrame(animate);

  if (state.switchboard.running) {
    const t = Math.max(0, (nowMs - state.switchboard.startMs) / 1000);
    setActivationAtTime(t);

    emitSwitchboardEvent("switchboard:frame", {
      stimulus_id: state.switchboard.stimulus?.id || null,
      t: state.switchboard.t,
      envelope: state.switchboard.envelope,
      build_id: SWITCHBOARD_BUILD_ID,
    });

    if (t >= state.switchboard.durationS && state.switchboard.envelope <= 0) {
      stopSwitchboard("completed");
    }
  }

  controls.autoRotate = state.autoRotate;
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

(async () => {
  try {
    hud(`SWITCHBOARD BUILD ${SWITCHBOARD_BUILD_ID}\nLoading graph...`);
    graph = await loadGraph();
    addNodes(graph);
    rebuildEdges();

    const stimuliTemplate = await loadStimuliTemplate();
    configureMusicStimulus(stimuliTemplate);

    hud(`SWITCHBOARD BUILD ${SWITCHBOARD_BUILD_ID}\nGraph OK (${graph.nodes.length} nodes)\nLoading hull...`);
    try {
      const hullObj = await loadHullObj();
      addHull(hullObj);
    } catch (e) {
      console.warn("Hull load failed:", e);
    }

    renderHud();
  } catch (e) {
    console.error(e);
    hud(`SWITCHBOARD BUILD ${SWITCHBOARD_BUILD_ID}\nERROR\n${e.message}`, true);
    ui.sbStatus.textContent = `Status: error (${e.message})`;
  }
})();
