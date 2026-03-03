import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const BUILD_ID = "1771549511";



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

// ---------- UI ----------
const buildEl = document.getElementById("build");
const hudEl = document.getElementById("hud");

const ui = {
  toggleEdges: document.getElementById("toggleEdges"),
  toggleHull:  document.getElementById("toggleHull"),
  toggleAuto:  document.getElementById("toggleAuto"),
  btnReset:    document.getElementById("btnReset"),
  edgeThresh:  document.getElementById("edgeThresh"),
  edgeVal:     document.getElementById("edgeVal"),
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

// ---------- Coordinate mapping ----------
const SCALE = 0.01; // 1 unit = 100mm
function mniToThree([x, y, z]) {
  return new THREE.Vector3(x * SCALE, z * SCALE, -y * SCALE);
}

// Cache-bust assets (OBJLoader doesn't give fetch cache controls)
const GRAPH_URL = `./assets/aal_graph.json?v=${BUILD_ID}`;
const HULL_URL  = `./assets/brain_hull.obj?v=${BUILD_ID}`;

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

// Node base data (for restoring after selection clears)
const nodeBase = []; // { pos: Vector3, baseScale: number, baseColor: Color }
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

  hud(lines.join("\n"));
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
  if (ev.key === "Escape") clearSelection();
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

syncUI();
renderHud();

// ---------- Render loop ----------
function animate() {
  requestAnimationFrame(animate);
  controls.autoRotate = state.autoRotate;
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
    rebuildEdges();

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
