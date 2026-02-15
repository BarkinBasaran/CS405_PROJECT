// js/app.js
import {
  ident,
  mul,
  translate,
  rotateZ,
  rotateX,
  rotateY,
  scale,
  lookAt,
  perspective,
  orthographic,
} from "./math.js";
import { initUI, getTRS, setMatrixHUD, scaleFromSlider } from "./ui.js";
import { generateHeightmapProcedural, generateHeightmapFromImage, buildTerrainMesh } from "./terrain.js";

// === Bezier yardımcıları ===
import {
  buildPolyline,
  controlToFloat32,
  controlPolygonLines,
  buildArcLengthLUT,
  arcLengthToT,
  evalHeading3D,
} from "./bezier.js";

const canvas = document.getElementById("glcanvas");

function resizeCanvasToDisplaySize(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(cv.clientWidth * dpr);
  const h = Math.floor(cv.clientHeight * dpr);
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
    return true;
  }
  return false;
}
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
if (!gl) throw new Error("WebGL not supported");

gl.clearColor(0.0, 0.0, 0.0, 1.0);
gl.enable(gl.DEPTH_TEST);

// ---------- shader utils ----------
async function loadText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url);
  return r.text();
}
function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    throw new Error("shader");
  }
  return s;
}
function linkProgram(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    throw new Error("link");
  }
  return p;
}

// ---------- programs ----------
let progSky,
  skyLoc = {};
let progGlass,
  glassLoc = {};
let progLine,
  lineLoc = {};

// Toon & Paint programları
let progToon,
  toonLoc = {};
let progPaint,
  paintLoc = {};

// Phase 3 terrain program
let progTerrain,
  terrainLoc = {};

let skyVbo;
let cubeVbo, cubeIbo;
let frustumVbo;
let bezierVbo;

// Phase 3 terrain buffers
let terrainVboPos, terrainVboNrm, terrainIbo;
let terrainIndexCount = 0;
let terrainMinY = 0.0, terrainMaxY = 1.0;
let terrainReady = false;

// ---------- tiny vec helpers ----------
function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function muls(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
// ---------- Phase 3: Terrain helpers ----------
function orbitEye() {
  const cp = Math.cos(orbitPitch);
  const sp = Math.sin(orbitPitch);
  const cy = Math.cos(orbitYaw);
  const sy = Math.sin(orbitYaw);

  const x = orbitRadius * cp * sy;
  const y = orbitRadius * sp;
  const z = orbitRadius * cp * cy;
  return [x, y, z];
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function uploadTerrainFromHeights(heights01) {
  if (!terrainReady) return;

  const res = terrainParams.res;
  const mesh = buildTerrainMesh(
    heights01,
    res,
    terrainParams.terrainSize,
    terrainParams.heightScale
  );

  terrainMinY = mesh.minY;
  terrainMaxY = mesh.maxY;
  terrainIndexCount = mesh.indices.length;

  gl.bindBuffer(gl.ARRAY_BUFFER, terrainVboPos);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, terrainVboNrm);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
}

function rebuildTerrainProcedural() {
  const heights01 = generateHeightmapProcedural(terrainParams.res, {
    seed: terrainSeed,
    octaves: terrainParams.octaves,
    persistence: terrainParams.persistence,
    lacunarity: terrainParams.lacunarity,
    noiseScale: terrainParams.noiseScale,
  });
  uploadTerrainFromHeights(heights01);
}

async function rebuildTerrainFromUpload(file) {
  const heights01 = await generateHeightmapFromImage(file, terrainParams.res);
  uploadTerrainFromHeights(heights01);
}

function ensureTerrainBuilt() {
  if (!terrainReady) return;
  if (terrainIndexCount > 0) return;
  // Default build
  rebuildTerrainProcedural();
}

function drawTerrain(aspect) {
  ensureTerrainBuilt();

  if (!terrainReady || terrainIndexCount <= 0) return;

  const M = ident();
  const eye = orbitEye();
  const V = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const P = perspective(45, aspect, 0.1, 1000.0);
  const MVP = mul(P, mul(V, M));

  gl.useProgram(progTerrain);

  gl.uniformMatrix4fv(terrainLoc.u_MVP, false, MVP);
  gl.uniformMatrix4fv(terrainLoc.u_M, false, M);
  gl.uniform1f(terrainLoc.u_hMin, terrainMinY);
  gl.uniform1f(terrainLoc.u_hMax, terrainMaxY);

  // A simple fixed directional light
  const L = norm([0.4, 1.0, 0.2]);
  gl.uniform3f(terrainLoc.u_lightDir, L[0], L[1], L[2]);
  gl.uniform1f(terrainLoc.u_ambient, 0.35);
  gl.uniform1f(terrainLoc.u_diffuse, 0.85);
  gl.uniform1i(terrainLoc.u_colorMode, terrainParams.colorMode);

  gl.bindBuffer(gl.ARRAY_BUFFER, terrainVboPos);
  gl.vertexAttribPointer(terrainLoc.a_pos, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(terrainLoc.a_pos);

  gl.bindBuffer(gl.ARRAY_BUFFER, terrainVboNrm);
  gl.vertexAttribPointer(terrainLoc.a_nrm, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(terrainLoc.a_nrm);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIbo);
  gl.drawElements(gl.TRIANGLES, terrainIndexCount, gl.UNSIGNED_SHORT, 0);
}

// --- Bezier 2D evaluator (Bezier modunda işaretçi için) ---
function bezier2D(ctrl, t) {
  const [P0, P1, P2, P3] = ctrl;
  const u = 1 - t,
    uu = u * u,
    tt = t * t;
  const x =
    uu * u * P0[0] + 3 * uu * t * P1[0] + 3 * u * tt * P2[0] + tt * t * P3[0];
  const y =
    uu * u * P0[1] + 3 * uu * t * P1[1] + 3 * u * tt * P2[1] + tt * t * P3[1];
  return [x, y];
}
function bezier2DTangent(ctrl, t) {
  const [P0, P1, P2, P3] = ctrl;
  const u = 1 - t;
  const dx =
    3 * u * u * (P1[0] - P0[0]) +
    6 * u * t * (P2[0] - P1[0]) +
    3 * t * t * (P3[0] - P2[0]);
  const dy =
    3 * u * u * (P1[1] - P0[1]) +
    6 * u * t * (P2[1] - P1[1]) +
    3 * t * t * (P3[1] - P2[1]);
  const L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
}

// ---------- Bezier (clip-space control points + dragging) ----------
let bezCtrl = [
  [-0.7, -0.3], // P0
  [-0.2, 0.6], // P1
  [0.2, -0.6], // P2
  [0.7, 0.2], // P3
];

// Follow-curve iç state (UI eşlemeleri)
let fc_enabled = false;
let fc_speed = 0.25; // birim/s (s param/sn)
let bezLUT = null; // arc-length LUT
let curveS = 0; // s in [0,1]
let lastTs = performance.now();

// Shading mode: "glass" | "toon" | "paint"
let currentShading = "glass";

// Scene mode: "phase12" | "terrain"
let currentScene = "phase12";

// Terrain mode: "procedural" | "upload"
let terrainMode = "procedural";
let terrainSeed = 1;
let terrainHasUploaded = false;

const terrainParams = {
  res: 128,
  terrainSize: 30,
  heightScale: 8.0,
  octaves: 5,
  persistence: 0.5,
  lacunarity: 2.0,
  noiseScale: 2.5,
  colorMode: 0, // 0 gradient, 1 gray
};

// Orbit camera (terrain)
let orbitYaw = 0.85;
let orbitPitch = 0.35;
let orbitRadius = 35.0;
let orbitDragging = false;
let orbitLastX = 0;
let orbitLastY = 0;


// --- UI ELEMANLARI (ADDED) ---
const btnPlay = document.getElementById("btnPlay");
const btnStop = document.getElementById("btnStop");
const speedSlider = document.getElementById("bezierSpeed");

// Phase 3 UI
const sceneRadios = document.querySelectorAll('input[name="scene"]');
const phase12Controls = document.getElementById("phase12Controls");
const terrainControls = document.getElementById("terrainControls");

const btnTerrainNew = document.getElementById("btnTerrainNew");
const terrainRes = document.getElementById("terrainRes");
const terrainResv = document.getElementById("terrainResv");
const terrainSize = document.getElementById("terrainSize");
const terrainSizev = document.getElementById("terrainSizev");
const heightScale = document.getElementById("heightScale");
const heightScalev = document.getElementById("heightScalev");

const octavesEl = document.getElementById("octaves");
const octavesv = document.getElementById("octavesv");
const persistenceEl = document.getElementById("persistence");
const persistencev = document.getElementById("persistencev");
const lacunarityEl = document.getElementById("lacunarity");
const lacunarityv = document.getElementById("lacunarityv");
const noiseScaleEl = document.getElementById("noiseScale");
const noiseScalev = document.getElementById("noiseScalev");

const heightmapFile = document.getElementById("heightmapFile");
const btnClearHeightmap = document.getElementById("btnClearHeightmap");

function applySceneUI() {
  if (phase12Controls) phase12Controls.style.display = currentScene === "phase12" ? "" : "none";
  if (terrainControls) terrainControls.style.display = currentScene === "terrain" ? "" : "none";
}

function readTerrainModeFromUI() {
  const el = document.querySelector('input[name="terrainMode"]:checked');
  if (el) terrainMode = el.value;
}

function syncTerrainLabels() {
  if (terrainResv && terrainRes) terrainResv.textContent = String(terrainRes.value);
  if (terrainSizev && terrainSize) terrainSizev.textContent = String(terrainSize.value);
  if (heightScalev && heightScale) heightScalev.textContent = String(parseFloat(heightScale.value).toFixed(1));

  if (octavesv && octavesEl) octavesv.textContent = String(octavesEl.value);
  if (persistencev && persistenceEl) persistencev.textContent = String(parseFloat(persistenceEl.value).toFixed(2));
  if (lacunarityv && lacunarityEl) lacunarityv.textContent = String(parseFloat(lacunarityEl.value).toFixed(2));
  if (noiseScalev && noiseScaleEl) noiseScalev.textContent = String(parseFloat(noiseScaleEl.value).toFixed(2));
}

function applyTerrainParamsFromUI() {
  if (terrainRes) terrainParams.res = Math.max(32, Math.min(200, parseInt(terrainRes.value)));
  if (terrainSize) terrainParams.terrainSize = parseFloat(terrainSize.value);
  if (heightScale) terrainParams.heightScale = parseFloat(heightScale.value);

  if (octavesEl) terrainParams.octaves = parseInt(octavesEl.value);
  if (persistenceEl) terrainParams.persistence = parseFloat(persistenceEl.value);
  if (lacunarityEl) terrainParams.lacunarity = parseFloat(lacunarityEl.value);
  if (noiseScaleEl) terrainParams.noiseScale = parseFloat(noiseScaleEl.value);
}


// UI’ye bağla (varsa)
if (speedSlider) {
  // ilk değer
  const v = parseFloat(speedSlider.value);
  if (!Number.isNaN(v)) fc_speed = v;

  speedSlider.addEventListener("input", () => {
    const nv = parseFloat(speedSlider.value);
    if (!Number.isNaN(nv)) fc_speed = Math.max(0.05, Math.min(2.0, nv));
  });
}
if (btnPlay) {
  btnPlay.addEventListener("click", () => {
    fc_enabled = true;
    lastTs = performance.now(); // delta reset
  });
}
if (btnStop) {
  btnStop.addEventListener("click", () => {
    fc_enabled = false;
  });
}

applySceneUI();
syncTerrainLabels();

sceneRadios.forEach((r) => {
  r.addEventListener("change", () => {
    currentScene = r.value;
    applySceneUI();
  });
});

document.querySelectorAll('input[name="terrainMode"]').forEach((r) => {
  r.addEventListener("change", () => {
    terrainMode = r.value;
    // If switching back to procedural, rebuild immediately
    if (terrainMode === "procedural" && currentScene === "terrain") {
      applyTerrainParamsFromUI();
      rebuildTerrainProcedural();
    }
  });
});

if (btnTerrainNew) {
  btnTerrainNew.addEventListener("click", () => {
    terrainSeed = (terrainSeed + 1 + Math.floor(Math.random() * 100000)) >>> 0;
    terrainHasUploaded = false;
    if (currentScene === "terrain") {
      applyTerrainParamsFromUI();
      rebuildTerrainProcedural();
    }
  });
}

function handleTerrainParamChange() {
  syncTerrainLabels();
  if (currentScene !== "terrain") return;
  applyTerrainParamsFromUI();
  if (terrainMode === "procedural") {
    rebuildTerrainProcedural();
  } else if (terrainHasUploaded && heightmapFile && heightmapFile.files && heightmapFile.files[0]) {
    // Re-sample the uploaded image at the new resolution
    rebuildTerrainFromUpload(heightmapFile.files[0]).catch(console.error);
  }
}

[terrainRes, terrainSize, heightScale, octavesEl, persistenceEl, lacunarityEl, noiseScaleEl].forEach((el) => {
  if (!el) return;
  el.addEventListener("input", handleTerrainParamChange);
});

if (heightmapFile) {
  heightmapFile.addEventListener("change", () => {
    if (!heightmapFile.files || !heightmapFile.files[0]) return;
    terrainMode = "upload";
    terrainHasUploaded = true;
    // force the UI radio to match
    const r = document.querySelector('input[name="terrainMode"][value="upload"]');
    if (r) r.checked = true;

    if (currentScene === "terrain") {
      applyTerrainParamsFromUI();
      rebuildTerrainFromUpload(heightmapFile.files[0]).catch(console.error);
    }
  });
}

if (btnClearHeightmap) {
  btnClearHeightmap.addEventListener("click", () => {
    terrainHasUploaded = false;
    if (heightmapFile) heightmapFile.value = "";
    terrainMode = "procedural";
    const r = document.querySelector('input[name="terrainMode"][value="procedural"]');
    if (r) r.checked = true;

    if (currentScene === "terrain") {
      applyTerrainParamsFromUI();
      rebuildTerrainProcedural();
    }
  });
}

// Klavye kısayolları: F toggle, [ ve ] hız, 1/2/3 shading
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "f" || e.key === "F") {
    fc_enabled = !fc_enabled;
    lastTs = performance.now();
    console.log("[FollowCurve]", fc_enabled ? "ON" : "OFF");
  } else if (e.key === "t" || e.key === "T") {
    currentScene = currentScene === "terrain" ? "phase12" : "terrain";
    // sync radio UI
    const r = document.querySelector(`input[name="scene"][value="${currentScene}"]`);
    if (r) r.checked = true;
    applySceneUI();
  } else if (e.key === "[") {
    fc_speed = Math.max(0.05, +(fc_speed - 0.05).toFixed(2));
    if (speedSlider) speedSlider.value = String(fc_speed);
    console.log("[CurveSpeed]", fc_speed);
  } else if (e.key === "]") {
    fc_speed = Math.min(2.0, +(fc_speed + 0.05).toFixed(2));
    if (speedSlider) speedSlider.value = String(fc_speed);
    console.log("[CurveSpeed]", fc_speed);
  } else if (e.key === "1") {
    currentShading = "glass";
    console.log("[Shading] glass + space bg");
  } else if (e.key === "2") {
    currentShading = "toon";
    console.log("[Shading] toon + toon bg");
  } else if (e.key === "3") {
    currentShading = "paint";
    console.log("[Shading] paint + paint bg");
  }
});

// Dışarıdan kontrol etmek istersen:
window.setFollowCurve = (on) => {
  fc_enabled = !!on;
  if (fc_enabled) lastTs = performance.now();
};
window.setCurveSpeed = (v) => {
  fc_speed = Math.max(0.05, Math.min(2.0, +v || 0.25));
  if (speedSlider) speedSlider.value = String(fc_speed);
};
window.setShadingMode = (mode) => {
  if (mode === "glass" || mode === "toon" || mode === "paint") {
    currentShading = mode;
  }
};

// --- Pointer-based dragging (DPI-safe) ---
let dragIdx = -1;

function pxToNdc(mx, my) {
  const rect = canvas.getBoundingClientRect(); // CSS px
  const x = ((mx - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((my - rect.top) / rect.height) * 2;
  return [x, y];
}
// px → NDC yarıçap eşiği
function ndcRadiusForPixels(pxRadius) {
  const rect = canvas.getBoundingClientRect();
  const rx = (pxRadius / rect.width) * 2;
  const ry = (pxRadius / rect.height) * 2;
  return Math.max(rx, ry);
}
function nearestCtrlByNDC(nx, ny) {
  const R = ndcRadiusForPixels(24); // tutması kolay
  const R2 = R * R;
  let best = -1,
    bestD2 = R2;
  for (let i = 0; i < 4; i++) {
    const dx = nx - bezCtrl[i][0];
    const dy = ny - bezCtrl[i][1];
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

canvas.addEventListener("pointerdown", (e) => {
  if (currentScene === "terrain") {
    orbitDragging = true;
    orbitLastX = e.clientX;
    orbitLastY = e.clientY;
    e.target.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = "grabbing";
    e.preventDefault();
    return;
  }

  const [nx, ny] = pxToNdc(e.clientX, e.clientY);
  dragIdx = nearestCtrlByNDC(nx, ny);
  if (dragIdx >= 0) {
    e.target.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = "grabbing";
    e.preventDefault();
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (currentScene === "terrain") {
    if (!orbitDragging) return;
    const dx = e.clientX - orbitLastX;
    const dy = e.clientY - orbitLastY;
    orbitLastX = e.clientX;
    orbitLastY = e.clientY;

    orbitYaw += dx * 0.01;
    orbitPitch += -dy * 0.01;
    orbitPitch = clamp(orbitPitch, -1.2, 1.2);
    return;
  }

  if (dragIdx < 0) return;
  const [nx, ny] = pxToNdc(e.clientX, e.clientY);
  bezCtrl[dragIdx][0] = Math.max(-1, Math.min(1, nx));
  bezCtrl[dragIdx][1] = Math.max(-1, Math.min(1, ny));
  // Eğri değişti → LUT tazele
  bezLUT = buildArcLengthLUT(bezCtrl, 400);
});

canvas.addEventListener("pointerup", (e) => {
  if (e.target.releasePointerCapture) e.target.releasePointerCapture(e.pointerId);

  orbitDragging = false;
  dragIdx = -1;
  canvas.style.cursor = "default";
});

canvas.addEventListener(
  "wheel",
  (e) => {
    if (currentScene !== "terrain") return;
    // Zoom
    orbitRadius *= 1.0 + e.deltaY * 0.001;
    orbitRadius = clamp(orbitRadius, 6.0, 250.0);
    e.preventDefault();
  },
  { passive: false }
);

window.addEventListener("bez-reset", () => {
  bezCtrl = [
    [-0.7, -0.3],
    [-0.2, 0.6],
    [0.2, -0.6],
    [0.7, 0.2],
  ];
  bezLUT = buildArcLengthLUT(bezCtrl, 400);
});

// viewport
function setViewport() {
  if (resizeCanvasToDisplaySize(canvas))
    gl.viewport(0, 0, canvas.width, canvas.height);
}

async function init() {
  initUI();

  // SKYBOX program
  {
    const [vsSrc, fsSrc] = await Promise.all([
      loadText("shaders/skybox.vert"),
      loadText("shaders/skybox.frag"),
    ]);
    progSky = linkProgram(
      compileShader(gl.VERTEX_SHADER, vsSrc),
      compileShader(gl.FRAGMENT_SHADER, fsSrc)
    );
    gl.useProgram(progSky);
    skyLoc.a_pos = gl.getAttribLocation(progSky, "a_pos");
    skyLoc.u_invVP = gl.getUniformLocation(progSky, "u_invVP");
    skyLoc.u_bgMode = gl.getUniformLocation(progSky, "u_bgMode"); // YENİ
    skyLoc.u_near = gl.getUniformLocation(progSky, "u_near"); // EKLE
    skyLoc.u_far = gl.getUniformLocation(progSky, "u_far"); // EKLE

    // fullscreen quad
    skyVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyVbo);
    const quad = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  }

  // GLASS program
  {
    const [vsSrc, fsSrc] = await Promise.all([
      loadText("shaders/glass.vert"),
      loadText("shaders/glass.frag"),
    ]);
    progGlass = linkProgram(
      compileShader(gl.VERTEX_SHADER, vsSrc),
      compileShader(gl.FRAGMENT_SHADER, fsSrc)
    );
    gl.useProgram(progGlass);
    glassLoc.a_pos = gl.getAttribLocation(progGlass, "a_pos");
    glassLoc.a_nrm = gl.getAttribLocation(progGlass, "a_nrm");
    glassLoc.a_col = gl.getAttribLocation(progGlass, "a_col");
    glassLoc.u_M = gl.getUniformLocation(progGlass, "u_M");
    glassLoc.u_V = gl.getUniformLocation(progGlass, "u_V");
    glassLoc.u_P = gl.getUniformLocation(progGlass, "u_P");
    glassLoc.u_invV = gl.getUniformLocation(progGlass, "u_invV");
    glassLoc.u_invVP = gl.getUniformLocation(progGlass, "u_invVP");
    glassLoc.u_IOR = gl.getUniformLocation(progGlass, "u_IOR");
    glassLoc.u_absorb = gl.getUniformLocation(progGlass, "u_absorb");
    glassLoc.u_refBoost = gl.getUniformLocation(progGlass, "u_refBoost");
  }

  // TOON program (NPR 1)
  {
    const [vsSrc, fsSrc] = await Promise.all([
      loadText("shaders/glass.vert"),
      loadText("shaders/toon.frag"),
    ]);
    progToon = linkProgram(
      compileShader(gl.VERTEX_SHADER, vsSrc),
      compileShader(gl.FRAGMENT_SHADER, fsSrc)
    );
    gl.useProgram(progToon);
    toonLoc.a_pos = gl.getAttribLocation(progToon, "a_pos");
    toonLoc.a_nrm = gl.getAttribLocation(progToon, "a_nrm");
    toonLoc.a_col = gl.getAttribLocation(progToon, "a_col");
    toonLoc.u_M = gl.getUniformLocation(progToon, "u_M");
    toonLoc.u_V = gl.getUniformLocation(progToon, "u_V");
    toonLoc.u_P = gl.getUniformLocation(progToon, "u_P");
    toonLoc.u_lightDir = gl.getUniformLocation(progToon, "u_lightDir");
    toonLoc.u_cameraPos = gl.getUniformLocation(progToon, "u_cameraPos");
    toonLoc.u_baseColor = gl.getUniformLocation(progToon, "u_baseColor");
    toonLoc.u_ambient = gl.getUniformLocation(progToon, "u_ambient");
    toonLoc.u_levels = gl.getUniformLocation(progToon, "u_levels");
  }

  // PAINT program (NPR 2)
  {
    const [vsSrc, fsSrc] = await Promise.all([
      loadText("shaders/glass.vert"),
      loadText("shaders/paint.frag"),
    ]);
    progPaint = linkProgram(
      compileShader(gl.VERTEX_SHADER, vsSrc),
      compileShader(gl.FRAGMENT_SHADER, fsSrc)
    );
    gl.useProgram(progPaint);
    paintLoc.a_pos = gl.getAttribLocation(progPaint, "a_pos");
    paintLoc.a_nrm = gl.getAttribLocation(progPaint, "a_nrm");
    paintLoc.a_col = gl.getAttribLocation(progPaint, "a_col");
    paintLoc.u_M = gl.getUniformLocation(progPaint, "u_M");
    paintLoc.u_V = gl.getUniformLocation(progPaint, "u_V");
    paintLoc.u_P = gl.getUniformLocation(progPaint, "u_P");
    paintLoc.u_lightDir = gl.getUniformLocation(progPaint, "u_lightDir");
    paintLoc.u_cameraPos = gl.getUniformLocation(progPaint, "u_cameraPos");
    paintLoc.u_baseColor = gl.getUniformLocation(progPaint, "u_baseColor");
    paintLoc.u_ambient = gl.getUniformLocation(progPaint, "u_ambient");
  }

  // LINE program (frustum + bezier)
  {
    const [vsSrc, fsSrc] = await Promise.all([
      loadText("shaders/line.vert"),
      loadText("shaders/line.frag"),
    ]);
    progLine = linkProgram(
      compileShader(gl.VERTEX_SHADER, vsSrc),
      compileShader(gl.FRAGMENT_SHADER, fsSrc)
    );
    gl.useProgram(progLine);
    lineLoc.a_pos = gl.getAttribLocation(progLine, "a_pos");
    lineLoc.u_V = gl.getUniformLocation(progLine, "u_V");
    lineLoc.u_P = gl.getUniformLocation(progLine, "u_P");
    lineLoc.u_color = gl.getUniformLocation(progLine, "u_color");
    lineLoc.u_pointSize = gl.getUniformLocation(progLine, "u_pointSize");

    frustumVbo = gl.createBuffer();
    bezierVbo = gl.createBuffer();
  }

  // ----- cube geometry -----
  const C = {
    back: [0.95, 0.95, 0.98],
    front: [0.98, 0.98, 0.98],
    left: [0.96, 0.97, 0.99],
    right: [0.97, 0.96, 0.99],
    bottom: [0.98, 0.96, 0.98],
    top: [0.96, 0.98, 0.98],
  };
  const N = {
    back: [0, 0, -1],
    front: [0, 0, 1],
    left: [-1, 0, 0],
    right: [1, 0, 0],
    bottom: [0, -1, 0],
    top: [0, 1, 0],
  };

  // TERRAIN program (Phase 3)
  {
    const [vsSrc, fsSrc] = await Promise.all([
      loadText("shaders/terrain.vert"),
      loadText("shaders/terrain.frag"),
    ]);
    progTerrain = linkProgram(
      compileShader(gl.VERTEX_SHADER, vsSrc),
      compileShader(gl.FRAGMENT_SHADER, fsSrc)
    );
    gl.useProgram(progTerrain);
    terrainLoc.a_pos = gl.getAttribLocation(progTerrain, "a_pos");
    terrainLoc.a_nrm = gl.getAttribLocation(progTerrain, "a_nrm");

    terrainLoc.u_MVP = gl.getUniformLocation(progTerrain, "u_MVP");
    terrainLoc.u_M = gl.getUniformLocation(progTerrain, "u_M");
    terrainLoc.u_hMin = gl.getUniformLocation(progTerrain, "u_hMin");
    terrainLoc.u_hMax = gl.getUniformLocation(progTerrain, "u_hMax");
    terrainLoc.u_lightDir = gl.getUniformLocation(progTerrain, "u_lightDir");
    terrainLoc.u_ambient = gl.getUniformLocation(progTerrain, "u_ambient");
    terrainLoc.u_diffuse = gl.getUniformLocation(progTerrain, "u_diffuse");
    terrainLoc.u_colorMode = gl.getUniformLocation(progTerrain, "u_colorMode");

    terrainVboPos = gl.createBuffer();
    terrainVboNrm = gl.createBuffer();
    terrainIbo = gl.createBuffer();
    terrainReady = true;
  }


  const v = (px, py, pz, c, n) => [
    px,
    py,
    pz,
    c[0],
    c[1],
    c[2],
    n[0],
    n[1],
    n[2],
  ];
  const verts = new Float32Array([
    ...v(-0.5, -0.5, -0.5, C.back, N.back),
    ...v(0.5, -0.5, -0.5, C.back, N.back),
    ...v(0.5, 0.5, -0.5, C.back, N.back),
    ...v(-0.5, 0.5, -0.5, C.back, N.back),
    ...v(-0.5, -0.5, 0.5, C.front, N.front),
    ...v(0.5, -0.5, 0.5, C.front, N.front),
    ...v(0.5, 0.5, 0.5, C.front, N.front),
    ...v(-0.5, 0.5, 0.5, C.front, N.front),
    ...v(-0.5, -0.5, -0.5, C.left, N.left),
    ...v(-0.5, 0.5, -0.5, C.left, N.left),
    ...v(-0.5, 0.5, 0.5, C.left, N.left),
    ...v(-0.5, -0.5, 0.5, C.left, N.left),
    ...v(0.5, -0.5, -0.5, C.right, N.right),
    ...v(0.5, 0.5, -0.5, C.right, N.right),
    ...v(0.5, 0.5, 0.5, C.right, N.right),
    ...v(0.5, -0.5, 0.5, C.right, N.right),
    ...v(-0.5, -0.5, -0.5, C.bottom, N.bottom),
    ...v(0.5, -0.5, -0.5, C.bottom, N.bottom),
    ...v(0.5, -0.5, 0.5, C.bottom, N.bottom),
    ...v(-0.5, -0.5, 0.5, C.bottom, N.bottom),
    ...v(-0.5, 0.5, -0.5, C.top, N.top),
    ...v(0.5, 0.5, -0.5, C.top, N.top),
    ...v(0.5, 0.5, 0.5, C.top, N.top),
    ...v(-0.5, 0.5, 0.5, C.top, N.top),
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14,
    15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
  ]);

  cubeVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeVbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  cubeIbo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  // Başlangıç LUT
  bezLUT = buildArcLengthLUT(bezCtrl, 400);

  requestAnimationFrame(frame);
}

// composeM artık state parametresi alıyor
function composeM(st) {
  const {
    tx,
    ty,
    rx,
    ry,
    rz,
    sx,
    sy,
    sz, // slider-space
    su,
    uniformScale,
    keepView,
    order,
  } = st;

  const suReal = scaleFromSlider(su);
  const sxReal = scaleFromSlider(sx);
  const syReal = scaleFromSlider(sy);
  const szReal = scaleFromSlider(sz);

  const sX = uniformScale ? suReal : sxReal;
  const sY = uniformScale ? suReal : syReal;
  const sZ = uniformScale ? suReal : szReal;

  let txC = tx,
    tyC = ty;
  if (keepView) {
    const r0 = 0.7,
      r = r0 * Math.max(Math.abs(sX), Math.abs(sY));
    const lx = 1 - r,
      ly = 1 - r;
    txC = Math.min(lx, Math.max(-lx, tx));
    tyC = Math.min(ly, Math.max(-ly, ty));
  }

  const T = translate(txC, tyC, 0);
  const Rx = rotateX(rx);
  const Ry = rotateY(ry);
  const Rz = rotateZ(rz);
  const R = mul(mul(Rz, Ry), Rx);
  const S = scale(sX, sY, sZ);

  const baseM = order === "TRS" ? mul(mul(T, R), S) : mul(mul(R, T), S);

  // === Follow Curve (UI -> fc_* bağlandı) ===
  const wantFollow =
    typeof st.followCurve === "boolean" ? st.followCurve : fc_enabled;
  const speed = typeof st.curveSpeed === "number" ? st.curveSpeed : fc_speed;

  if (wantFollow && bezLUT) {
    // delta time
    const now = performance.now();
    const dt = Math.max(0, (now - lastTs) / 1000);
    lastTs = now;

    curveS = (curveS + dt * Math.max(0.0, speed)) % 1.0;
    const t = arcLengthToT(curveS, bezLUT);

    // 2D clip kontrol noktalarını dünya XZ düzlemine taşı
    const scaleWorld = 2.0; // ~[-1..1] → ~[-2..2]
    const { p3, heading } = evalHeading3D(t, bezCtrl, "XZ");
    const x = p3[0] * scaleWorld;
    const z = p3[2] * scaleWorld;

    const Tpath = translate(x, 0, z);
    const Ryaw = rotateY((heading * 180) / Math.PI); // derece
    return mul(mul(Tpath, Ryaw), S);
  }

  return baseM;
}

// Build frustum line vertices in WORLD space
function buildFrustumLines(
  eye,
  target,
  up,
  projection,
  fovDeg,
  aspect,
  near,
  far,
  orthoHalfHeight
) {
  const f = norm(sub(target, eye)); // forward
  const r = norm(cross(f, up)); // right
  const u = norm(cross(r, f)); // true up

  const cN = add(eye, muls(f, near));
  const cF = add(eye, muls(f, far));

  let nHalfH, nHalfW, fHalfH, fHalfW;
  if (projection === "perspective") {
    const fovRad = (fovDeg * Math.PI) / 180.0;
    nHalfH = Math.tan(0.5 * fovRad) * near;
    nHalfW = nHalfH * aspect;
    fHalfH = Math.tan(0.5 * fovRad) * far;
    fHalfW = fHalfH * aspect;
  } else {
    nHalfH = orthoHalfHeight;
    nHalfW = orthoHalfHeight * aspect;
    fHalfH = nHalfH;
    fHalfW = nHalfW;
  }

  const nTL = add(add(cN, muls(u, nHalfH)), muls(r, -nHalfW));
  const nTR = add(add(cN, muls(u, nHalfH)), muls(r, nHalfW));
  const nBL = add(add(cN, muls(u, -nHalfH)), muls(r, -nHalfW));
  const nBR = add(add(cN, muls(u, -nHalfH)), muls(r, nHalfW));

  const fTL = add(add(cF, muls(u, fHalfH)), muls(r, -fHalfW));
  const fTR = add(add(cF, muls(u, fHalfH)), muls(r, fHalfW));
  const fBL = add(add(cF, muls(u, -fHalfH)), muls(r, -fHalfW));
  const fBR = add(add(cF, muls(u, -fHalfH)), muls(r, fHalfW));

  const L = [
    // near rectangle
    ...nTL,
    ...nTR,
    ...nTR,
    ...nBR,
    ...nBR,
    ...nBL,
    ...nBL,
    ...nTL,
    // far rectangle
    ...fTL,
    ...fTR,
    ...fTR,
    ...fBR,
    ...fBR,
    ...fBL,
    ...fBL,
    ...fTL,
    // connecting edges
    ...nTL,
    ...fTL,
    ...nTR,
    ...fTR,
    ...nBL,
    ...fBL,
    ...nBR,
    ...fBR,
  ];
  return new Float32Array(L);
}

// 2D clip-space Bézier polyline'ını dünya XZ düzlemine taşır (y: verilen yükseklik)
function bezierWorldPolylineXZ(ctrl, scaleWorld = 2.0, yHeight = 0.001) {
  const poly = buildPolyline(ctrl); // clip-space: x,y, z=0
  const out = new Float32Array(poly.length);
  for (let i = 0; i < poly.length; i += 3) {
    const x = poly[i];
    const y = poly[i + 1];
    out[i + 0] = x * scaleWorld; // X
    out[i + 1] = yHeight; // Y: dinamik (cismin altı)
    out[i + 2] = y * scaleWorld; // Z (ekran +y → dünya +z)
  }
  return out;
}

function drawScenePass(V, P, invV, invVP, st, eye) {
  // 1) SKYBOX
  gl.depthMask(false);
  gl.useProgram(progSky);
  gl.bindBuffer(gl.ARRAY_BUFFER, skyVbo);
  gl.vertexAttribPointer(skyLoc.a_pos, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(skyLoc.a_pos);
  gl.uniformMatrix4fv(skyLoc.u_invVP, false, invVP);

  // arka plan modu: 0=space,1=toon,2=paint
  let bgMode = 0;
  if (currentShading === "toon") bgMode = 1;
  else if (currentShading === "paint") bgMode = 2;
  gl.uniform1i(skyLoc.u_bgMode, bgMode);
  gl.uniform1f(skyLoc.u_near, st.near);
  gl.uniform1f(skyLoc.u_far, st.far);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.depthMask(true);

  // 2) CUBE (Glass / Toon / Paint)
  const M = composeM(st);

  const shading = currentShading; // st.den değil, global moddan
  let prog = progGlass;
  let loc = glassLoc;
  let mode = "glass";

  if (shading === "toon") {
    prog = progToon;
    loc = toonLoc;
    mode = "toon";
  } else if (shading === "paint") {
    prog = progPaint;
    loc = paintLoc;
    mode = "paint";
  }

  gl.useProgram(prog);

  gl.uniformMatrix4fv(loc.u_M, false, M);
  gl.uniformMatrix4fv(loc.u_V, false, V);
  gl.uniformMatrix4fv(loc.u_P, false, P);

  if (mode === "glass") {
    gl.uniformMatrix4fv(glassLoc.u_invV, false, invV);
    gl.uniformMatrix4fv(glassLoc.u_invVP, false, invVP);

    gl.uniform1f(glassLoc.u_IOR, 1.52);
    gl.uniform1f(glassLoc.u_absorb, 0.03);
    gl.uniform1f(glassLoc.u_refBoost, 0.28);
  } else {
    const lightDir = norm([0.5, 1.0, 0.2]);
    gl.uniform3f(loc.u_lightDir, lightDir[0], lightDir[1], lightDir[2]);
    gl.uniform3f(loc.u_cameraPos, eye[0], eye[1], eye[2]);
    gl.uniform3f(loc.u_baseColor, 0.9, 0.95, 1.0); // hafif mavi-beyaz
    gl.uniform3f(loc.u_ambient, 0.15, 0.18, 0.22);

    if (mode === "toon" && toonLoc.u_levels) {
      gl.uniform1i(toonLoc.u_levels, 4);
    }
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, cubeVbo);
  const STRIDE = 9 * 4;
  gl.vertexAttribPointer(loc.a_pos, 3, gl.FLOAT, false, STRIDE, 0);
  gl.enableVertexAttribArray(loc.a_pos);
  gl.vertexAttribPointer(loc.a_col, 3, gl.FLOAT, false, STRIDE, 3 * 4);
  gl.enableVertexAttribArray(loc.a_col);
  gl.vertexAttribPointer(loc.a_nrm, 3, gl.FLOAT, false, STRIDE, 6 * 4);
  gl.enableVertexAttribArray(loc.a_nrm);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIbo);

  gl.enable(gl.CULL_FACE);

  if (mode === "glass") {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // back faces
    gl.cullFace(gl.FRONT);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);

    // front faces
    gl.cullFace(gl.BACK);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);

    gl.disable(gl.BLEND);
  } else {
    // Toon / Paint – tek geçiş, opak
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
  }

  return M;
}

function frame() {
  setViewport();
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const st = getTRS();
  const aspect = canvas.clientWidth / canvas.clientHeight;

  if (currentScene === "terrain") {
    drawTerrain(aspect);
    requestAnimationFrame(frame);
    return;
  }

  // --- CAMERA ---
  const eye = [2.0, 1.5, 8.0],
    target = [0, 0, 0],
    up = [0, 1, 0];
  const V = lookAt(eye, target, up);

  // --- PROJECTION ---
  let P,
    orthoHalfH = 2.0;
  if (st.projection === "perspective") {
    P = perspective(st.fov, aspect, st.near, st.far);
  } else {
    orthoHalfH = typeof st.orthoSize === "number" ? st.orthoSize : 2.0;
    P = orthographic(
      -orthoHalfH * aspect,
      orthoHalfH * aspect,
      -orthoHalfH,
      orthoHalfH,
      st.near,
      st.far
    );
  }

  // inverse helpers
  function invert(m) {
    const a = new Float32Array(m);
    const inv = new Float32Array(16);
    inv[0] =
      a[5] * a[10] * a[15] -
      a[5] * a[11] * a[14] -
      a[9] * a[6] * a[15] +
      a[9] * a[7] * a[14] +
      a[13] * a[6] * a[11] -
      a[13] * a[7] * a[10];
    inv[4] =
      -a[4] * a[10] * a[15] +
      a[4] * a[11] * a[14] +
      a[8] * a[6] * a[15] -
      a[8] * a[7] * a[14] -
      a[12] * a[6] * a[11] +
      a[12] * a[7] * a[10];
    inv[8] =
      a[4] * a[9] * a[15] -
      a[4] * a[11] * a[13] -
      a[8] * a[5] * a[15] +
      a[8] * a[7] * a[13] +
      a[12] * a[5] * a[11] -
      a[12] * a[7] * a[9];
    inv[12] =
      -a[4] * a[9] * a[14] +
      a[4] * a[10] * a[13] +
      a[8] * a[5] * a[14] -
      a[8] * a[6] * a[13] -
      a[12] * a[5] * a[10] +
      a[12] * a[6] * a[9];
    inv[1] =
      -a[1] * a[10] * a[15] +
      a[1] * a[11] * a[14] +
      a[9] * a[2] * a[15] -
      a[9] * a[3] * a[14] -
      a[13] * a[2] * a[11] +
      a[13] * a[3] * a[10];
    inv[5] =
      a[0] * a[10] * a[15] -
      a[0] * a[11] * a[14] -
      a[8] * a[2] * a[15] +
      a[8] * a[3] * a[14] +
      a[12] * a[2] * a[11] -
      a[12] * a[3] * a[10];
    inv[9] =
      -a[0] * a[9] * a[15] +
      a[0] * a[11] * a[13] +
      a[8] * a[1] * a[15] -
      a[8] * a[3] * a[13] -
      a[12] * a[1] * a[11] +
      a[12] * a[3] * a[9];
    inv[13] =
      a[0] * a[9] * a[14] -
      a[0] * a[10] * a[13] -
      a[8] * a[1] * a[14] +
      a[8] * a[2] * a[13] +
      a[12] * a[1] * a[10] -
      a[12] * a[2] * a[9];
    inv[2] =
      a[1] * a[6] * a[15] -
      a[1] * a[7] * a[14] -
      a[5] * a[2] * a[15] +
      a[5] * a[3] * a[14] +
      a[13] * a[2] * a[7] -
      a[13] * a[3] * a[6];
    inv[6] =
      -a[0] * a[6] * a[15] +
      a[0] * a[7] * a[14] +
      a[4] * a[2] * a[15] -
      a[4] * a[3] * a[14] -
      a[12] * a[2] * a[7] +
      a[12] * a[3] * a[6];
    inv[10] =
      a[0] * a[5] * a[15] -
      a[0] * a[7] * a[13] -
      a[4] * a[1] * a[15] +
      a[4] * a[3] * a[13] +
      a[12] * a[1] * a[7] -
      a[12] * a[3] * a[5];
    inv[14] =
      -a[0] * a[5] * a[14] +
      a[0] * a[6] * a[13] +
      a[4] * a[1] * a[14] -
      a[4] * a[2] * a[13] -
      a[12] * a[1] * a[6] +
      a[12] * a[2] * a[5];
    inv[3] =
      -a[1] * a[6] * a[11] +
      a[1] * a[7] * a[10] +
      a[5] * a[2] * a[11] -
      a[5] * a[3] * a[10] -
      a[9] * a[2] * a[7] +
      a[9] * a[3] * a[6];
    inv[7] =
      a[0] * a[6] * a[11] -
      a[0] * a[7] * a[10] -
      a[4] * a[2] * a[11] +
      a[4] * a[3] * a[10] +
      a[8] * a[2] * a[7] -
      a[8] * a[3] * a[6];
    inv[11] =
      -a[0] * a[5] * a[11] +
      a[0] * a[7] * a[9] +
      a[4] * a[1] * a[11] -
      a[4] * a[3] * a[9] -
      a[8] * a[1] * a[7] +
      a[8] * a[3] * a[5];
    inv[15] =
      a[0] * a[5] * a[10] -
      a[0] * a[6] * a[9] -
      a[4] * a[1] * a[10] +
      a[4] * a[2] * a[9] +
      a[8] * a[1] * a[6] -
      a[8] * a[2] * a[5];
    let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    det = det ? 1.0 / det : 1.0;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  }
  const invVP = invert(mul(P, V));
  const invV = invert(V);

  if (st.mode === "scene") {
    const M = drawScenePass(V, P, invV, invVP, st, eye);
    // --- PATH UNDER OBJECT (tam altına yerleştir) ---
    {
      const wantFollow =
        typeof st.followCurve === "boolean" ? st.followCurve : fc_enabled;
      if (wantFollow) {
        // ölçekleri slider-space → gerçek scale'e çevir
        const suReal = scaleFromSlider(st.su);
        const syReal = scaleFromSlider(st.sy);
        const sY = st.uniformScale ? suReal : syReal;

        // cismin alt yüzeyi: -0.5 * sY → yol için çok az daha aşağıya
        const yUnder = -0.5 * sY - 0.001;

        const worldCurve = bezierWorldPolylineXZ(bezCtrl, 2.0, yUnder);
        gl.useProgram(progLine);
        gl.uniformMatrix4fv(lineLoc.u_V, false, V);
        gl.uniformMatrix4fv(lineLoc.u_P, false, P);
        gl.uniform3f(lineLoc.u_color, 0.55, 0.8, 0.95); // yol rengi
        gl.bindBuffer(gl.ARRAY_BUFFER, bezierVbo);
        gl.bufferData(gl.ARRAY_BUFFER, worldCurve, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(lineLoc.a_pos, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(lineLoc.a_pos);
        gl.drawArrays(gl.LINE_STRIP, 0, worldCurve.length / 3);
      }
    }

    // frustum lines over the scene (optional)
    const lines = buildFrustumLines(
      [2.0, 1.5, 8.0],
      [0, 0, 0],
      [0, 1, 0],
      st.projection,
      st.fov,
      aspect,
      st.near,
      st.far,
      st.projection === "ortho" ? st.orthoSize || 2.0 : 2.0
    );
    gl.useProgram(progLine);
    gl.uniformMatrix4fv(lineLoc.u_V, false, V);
    gl.uniformMatrix4fv(lineLoc.u_P, false, P);
    gl.uniform3f(lineLoc.u_color, 0.9, 0.35, 0.35);
    gl.bindBuffer(gl.ARRAY_BUFFER, frustumVbo);
    gl.bufferData(gl.ARRAY_BUFFER, lines, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(lineLoc.a_pos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(lineLoc.a_pos);
    gl.drawArrays(gl.LINES, 0, lines.length / 3);

    // inset (sol-alt, küçük)
    if (st.showInset) {
      const margin = 16;
      const iw = Math.floor(canvas.width * 0.32);
      const ih = Math.floor(iw * 0.6);
      gl.viewport(margin, margin, iw, ih);
      gl.scissor(margin, margin, iw, ih);
      gl.enable(gl.SCISSOR_TEST);
      gl.clearColor(0.02, 0.02, 0.05, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);

      const Vdbg = lookAt([10, 8, 10], [0, 0, 0], [0, 1, 0]);
      const Pdbg = perspective(45, iw / ih, 0.1, 1000.0);

      gl.useProgram(progLine);
      gl.uniformMatrix4fv(lineLoc.u_V, false, Vdbg);
      gl.uniformMatrix4fv(lineLoc.u_P, false, Pdbg);
      gl.uniform3f(lineLoc.u_color, 0.95, 0.45, 0.45);

      gl.bindBuffer(gl.ARRAY_BUFFER, frustumVbo);
      gl.bufferData(gl.ARRAY_BUFFER, lines, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(lineLoc.a_pos, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(lineLoc.a_pos);
      gl.drawArrays(gl.LINES, 0, lines.length / 3);

      // axes
      const axes = new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1,
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, axes, gl.DYNAMIC_DRAW);
      gl.uniform3f(lineLoc.u_color, 0.9, 0.2, 0.2);
      gl.drawArrays(gl.LINES, 0, 2);
      gl.uniform3f(lineLoc.u_color, 0.2, 0.9, 0.2);
      gl.drawArrays(gl.LINES, 2, 2);
      gl.uniform3f(lineLoc.u_color, 0.2, 0.5, 0.95);
      gl.drawArrays(gl.LINES, 4, 2);

      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    setMatrixHUD(M);
  } else {
    // --- BEZIER MODE (2D clip-space overlay) ---
    gl.clearColor(0.015, 0.015, 0.03, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Animasyon açıksa s'yi Bezier modunda da ilerlet
    if (fc_enabled && bezLUT) {
      const now = performance.now();
      const dt = Math.max(0, (now - lastTs) / 1000);
      lastTs = now;
      curveS = (curveS + dt * Math.max(0.0, fc_speed)) % 1.0;
    }

    // Line shader'ı identity ile (clip-space data çiziyoruz)
    gl.useProgram(progLine);
    gl.uniformMatrix4fv(lineLoc.u_V, false, ident());
    gl.uniformMatrix4fv(lineLoc.u_P, false, ident());

    // Kontrol çokgeni
    const ctrlLine = controlPolygonLines(bezCtrl);
    gl.uniform3f(lineLoc.u_color, 0.35, 0.8, 0.9);
    gl.bindBuffer(gl.ARRAY_BUFFER, bezierVbo);
    gl.bufferData(gl.ARRAY_BUFFER, ctrlLine, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(lineLoc.a_pos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(lineLoc.a_pos);
    gl.drawArrays(gl.LINES, 0, ctrlLine.length / 3);

    // Bézier eğrisi
    const curve = buildPolyline(bezCtrl);
    gl.uniform3f(lineLoc.u_color, 0.95, 0.45, 0.45);
    gl.bufferData(gl.ARRAY_BUFFER, curve, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINE_STRIP, 0, curve.length / 3);

    // Kontrol noktaları (POINTS)
    const ctrlPts = controlToFloat32(bezCtrl);
    gl.uniform3f(lineLoc.u_color, 0.98, 0.98, 0.98);
    gl.uniform1f(lineLoc.u_pointSize, 12.0);
    gl.bufferData(gl.ARRAY_BUFFER, ctrlPts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, 4);

    // Hareketli işaretçi + teğet oku (opsiyonel)
    if (bezLUT && fc_enabled) {
      const t = arcLengthToT(curveS, bezLUT);

      // 2D Bezier konumu ve teğetini hesapla
      const [px, py] = bezier2D(bezCtrl, t);
      const [tx, ty] = bezier2DTangent(bezCtrl, t);

      // Nokta (POINT)
      const marker = new Float32Array([px, py, 0]);
      gl.uniform3f(lineLoc.u_color, 0.98, 0.95, 0.85);
      gl.uniform1f(lineLoc.u_pointSize, 10.0);
      gl.bufferData(gl.ARRAY_BUFFER, marker, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, 1);

      // Teğet çizgisi (kısa)
      const L = 0.08; // NDC uzunluk
      const tip = new Float32Array([px, py, 0, px + tx * L, py + ty * L, 0]);
      gl.uniform3f(lineLoc.u_color, 0.9, 0.8, 0.2);
      gl.bufferData(gl.ARRAY_BUFFER, tip, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(lineLoc.a_pos, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(lineLoc.a_pos);
      gl.drawArrays(gl.LINES, 0, 2);
    }
  }

  requestAnimationFrame(frame);
}

init().catch((e) => {
  console.error(e);
  alert("Init failed");
});