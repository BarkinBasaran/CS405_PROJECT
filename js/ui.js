// js/ui.js
// UI state + bindings (TRS/RTS, Projection, LOG near/far, Inset button, Mode: scene|bezier)

const $ = (id) => document.getElementById(id);

// ---------- Scale helpers ----------
const SCALE_BASE = 2.0;
const scaleFromSlider = (x) => Math.pow(SCALE_BASE, x);

// ---------- Log mapping ----------
const NEAR_MIN = 0.05,
  NEAR_MAX = 100.0;
const FAR_MIN = 10.0,
  FAR_MAX = 5000.0;
const NEAR_SL_MIN = 1,
  NEAR_SL_MAX = 200;
const FAR_SL_MIN = 100,
  FAR_SL_MAX = 5000;

function log10n(x) {
  return Math.log(x) / Math.LN10;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function slider01From(el, slMin, slMax) {
  if (!el) return 0;
  const x = Number(el.value);
  return clamp((x - slMin) / (slMax - slMin), 0, 1);
}
function logLerp01(t, a, b) {
  const la = log10n(a),
    lb = log10n(b);
  return Math.pow(10, la + t * (lb - la));
}
function invLogLerp(v, a, b, slMin, slMax) {
  const t = (log10n(v) - log10n(a)) / (log10n(b) - log10n(a));
  return Math.round(slMin + t * (slMax - slMin));
}

const el = {
  tx: $("tx"),
  ty: $("ty"),
  rx: $("rx"),
  ry: $("ry"),
  rz: $("rz"),
  sx: $("sx"),
  sy: $("sy"),
  sz: $("sz"),
  su: $("su"),
  uScale: $("uScale"),
  txv: $("txv"),
  tyv: $("tyv"),
  rxv: $("rxv"),
  ryv: $("ryv"),
  rzv: $("rzv"),
  sxv: $("sxv"),
  syv: $("syv"),
  szv: $("szv"),
  suv: $("suv"),
  keepView: $("keepView"),

  orderRadios: Array.from(document.querySelectorAll('input[name="order"]')),
  orderv: $("orderv"),

  projectionRadios: Array.from(
    document.querySelectorAll('input[name="projection"]')
  ),

  fov: $("fov"),
  near: $("near"),
  far: $("far"),
  fovv: $("fovv"),
  nearv: $("nearv"),
  farv: $("farv"),

  orthoSize: $("orthoSize"),
  orthoSizev: $("orthoSizev"),

  showInsetBtn: $("showInsetBtn"),

  modeRadios: Array.from(document.querySelectorAll('input[name="mode"]')),
  bezReset: $("bezReset"),

  // NEW: shading radios
  shadingRadios: Array.from(document.querySelectorAll('input[name="shading"]')),

  mgrid: $("mgrid"),
};

// ---------- App UI state ----------
const state = {
  tx: 0.0,
  ty: 0.0,
  rx: 0.0,
  ry: 0.0,
  rz: 0.0,
  sx: 0.0,
  sy: 0.0,
  sz: 0.0, // slider-space
  su: 0.0,
  uniformScale: true,
  keepView: false,
  order: "TRS",

  projection: "perspective",
  fov: 45,
  near: 0.1,
  far: 100.0,
  orthoSize: 2.0,

  // Debug
  showInset: false,

  // Mode
  mode: "scene", // "scene" | "bezier"

  // NEW: shading mode
  shading: "glass", // "glass" | "toon" | "paint"
};

// ---------- Matrix HUD ----------
let mCells = [];
function buildMatrixHUD() {
  if (!el.mgrid) return;
  el.mgrid.innerHTML = "";
  mCells = [];
  for (let i = 0; i < 16; i++) {
    const d = document.createElement("div");
    d.className = "mcell";
    d.textContent = i % 5 === 0 ? "1.00" : "0.00";
    el.mgrid.appendChild(d);
    mCells.push(d);
  }
}
export function setMatrixHUD(M) {
  if (!M || !mCells || mCells.length !== 16) return;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      const idx = r * 4 + c;
      const mi = c * 4 + r;
      mCells[idx].textContent = Number(M[mi]).toFixed(2);
    }
  }
}

// ---------- Labels & enables ----------
function syncLabels() {
  el.txv && (el.txv.textContent = state.tx.toFixed(2));
  el.tyv && (el.tyv.textContent = state.ty.toFixed(2));
  el.rxv && (el.rxv.textContent = `${Math.round(state.rx)}°`);
  el.ryv && (el.ryv.textContent = `${Math.round(state.ry)}°`);
  el.rzv && (el.rzv.textContent = `${Math.round(state.rz)}°`);

  el.sxv && (el.sxv.textContent = scaleFromSlider(state.sx).toFixed(2));
  el.syv && (el.syv.textContent = scaleFromSlider(state.sy).toFixed(2));
  el.szv && (el.szv.textContent = scaleFromSlider(state.sz).toFixed(2));
  el.suv && (el.suv.textContent = scaleFromSlider(state.su).toFixed(2));

  el.fovv && (el.fovv.textContent = Math.round(state.fov));
  el.nearv && (el.nearv.textContent = state.near.toFixed(2));
  el.farv &&
    (el.farv.textContent =
      state.far < 100 ? state.far.toFixed(1) : state.far.toFixed(0));
  el.orthoSizev && (el.orthoSizev.textContent = state.orthoSize.toFixed(1));
}

function applyProjectionParamEnables() {
  if (el.fov) {
    if (state.projection === "perspective") el.fov.removeAttribute("disabled");
    else el.fov.setAttribute("disabled", "disabled");
  }
  if (el.orthoSize) {
    if (state.projection === "ortho") el.orthoSize.removeAttribute("disabled");
    else el.orthoSize.setAttribute("disabled", "disabled");
  }
}

function ensureNearFarConsistency() {
  const minFar = Math.max(FAR_MIN, state.near * 1.1);
  if (state.far < minFar) {
    state.far = minFar;
    el.far &&
      (el.far.value = invLogLerp(
        state.far,
        FAR_MIN,
        FAR_MAX,
        FAR_SL_MIN,
        FAR_SL_MAX
      ));
  }
}

function updateInsetButton() {
  el.showInsetBtn &&
    (el.showInsetBtn.textContent = state.showInset ? "Hide" : "Show");
}

// ---------- Bindings ----------
function bind() {
  // Transforms
  el.tx &&
    (el.tx.oninput = (e) => {
      state.tx = +e.target.value;
      el.txv && (el.txv.textContent = state.tx.toFixed(2));
    });
  el.ty &&
    (el.ty.oninput = (e) => {
      state.ty = +e.target.value;
      el.tyv && (el.tyv.textContent = state.ty.toFixed(2));
    });
  el.rx &&
    (el.rx.oninput = (e) => {
      state.rx = +e.target.value;
      el.rxv && (el.rxv.textContent = `${Math.round(state.rx)}°`);
    });
  el.ry &&
    (el.ry.oninput = (e) => {
      state.ry = +e.target.value;
      el.ryv && (el.ryv.textContent = `${Math.round(state.ry)}°`);
    });
  el.rz &&
    (el.rz.oninput = (e) => {
      state.rz = +e.target.value;
      el.rzv && (el.rzv.textContent = `${Math.round(state.rz)}°`);
    });

  el.sx &&
    (el.sx.oninput = (e) => {
      state.sx = +e.target.value;
      el.sxv && (el.sxv.textContent = scaleFromSlider(state.sx).toFixed(2));
    });
  el.sy &&
    (el.sy.oninput = (e) => {
      state.sy = +e.target.value;
      el.syv && (el.syv.textContent = scaleFromSlider(state.sy).toFixed(2));
    });
  el.sz &&
    (el.sz.oninput = (e) => {
      state.sz = +e.target.value;
      el.szv && (el.szv.textContent = scaleFromSlider(state.sz).toFixed(2));
    });

  el.su &&
    (el.su.oninput = (e) => {
      state.su = +e.target.value;
      const s = scaleFromSlider(state.su);
      el.suv && (el.suv.textContent = s.toFixed(2));
      if (state.uniformScale) {
        state.sx = state.sy = state.sz = state.su;
        el.sx && (el.sx.value = state.sx);
        el.sy && (el.sy.value = state.sy);
        el.sz && (el.sz.value = state.sz);
        el.sxv && (el.sxv.textContent = s.toFixed(2));
        el.syv && (el.syv.textContent = s.toFixed(2));
        el.szv && (el.szv.textContent = s.toFixed(2));
      }
    });

  el.uScale &&
    (el.uScale.onchange = (e) => {
      state.uniformScale = e.target.checked;
      if (state.uniformScale) {
        state.sx = state.sy = state.sz = state.su;
        el.sx && (el.sx.value = state.sx);
        el.sy && (el.sy.value = state.sy);
        el.sz && (el.sz.value = state.sz);
        el.sx?.setAttribute("disabled", "disabled");
        el.sy?.setAttribute("disabled", "disabled");
        el.sz?.setAttribute("disabled", "disabled");
        const s = scaleFromSlider(state.su);
        el.sxv && (el.sxv.textContent = s.toFixed(2));
        el.syv && (el.syv.textContent = s.toFixed(2));
        el.szv && (el.szv.textContent = s.toFixed(2));
      } else {
        el.sx?.removeAttribute("disabled");
        el.sy?.removeAttribute("disabled");
        el.sz?.removeAttribute("disabled");
      }
    });

  el.keepView &&
    (el.keepView.onchange = (e) => {
      state.keepView = e.target.checked;
    });

  // Order
  el.orderRadios.forEach(
    (r) =>
      (r.onchange = () => {
        if (r.checked) {
          state.order = r.value;
          el.orderv && (el.orderv.textContent = state.order);
        }
      })
  );

  // Projection radios
  el.projectionRadios.forEach((r) => {
    r.onchange = () => {
      if (r.checked) {
        state.projection = r.value;
        applyProjectionParamEnables();
      }
    };
  });

  // FOV
  el.fov &&
    (el.fov.oninput = (e) => {
      state.fov = clamp(+e.target.value, 30, 90);
      el.fovv && (el.fovv.textContent = Math.round(state.fov));
    });

  // LOG Near/Far
  el.near &&
    (el.near.oninput = () => {
      const t = slider01From(el.near, NEAR_SL_MIN, NEAR_SL_MAX);
      state.near = logLerp01(t, NEAR_MIN, NEAR_MAX);
      el.nearv && (el.nearv.textContent = state.near.toFixed(2));
      ensureNearFarConsistency();
    });
  el.far &&
    (el.far.oninput = () => {
      const t = slider01From(el.far, FAR_SL_MIN, FAR_SL_MAX);
      state.far = logLerp01(t, FAR_MIN, FAR_MAX);
      el.farv &&
        (el.farv.textContent =
          state.far < 100 ? state.far.toFixed(1) : state.far.toFixed(0));
      ensureNearFarConsistency();
    });

  // Ortho Size
  el.orthoSize &&
    (el.orthoSize.oninput = (e) => {
      state.orthoSize = Math.max(0.1, +e.target.value);
      el.orthoSizev && (el.orthoSizev.textContent = state.orthoSize.toFixed(1));
    });

  // Inset button
  el.showInsetBtn &&
    (el.showInsetBtn.onclick = () => {
      state.showInset = !state.showInset;
      updateInsetButton();
    });

  // Mode radios
  el.modeRadios.forEach(
    (r) =>
      (r.onchange = () => {
        if (r.checked) {
          state.mode = r.value;
        }
      })
  );

  el.shadingRadios.forEach((r) => {
    r.onchange = () => {
      if (r.checked) {
        state.shading = r.value;

        // app.js içindeki currentShading globalini de güncelle
        if (window.setShadingMode) {
          window.setShadingMode(state.shading);
        }
      }
    };
  });

  // Bézier reset event (app.js dinleyecek)
  el.bezReset &&
    (el.bezReset.onclick = () => {
      const ev = new CustomEvent("bez-reset");
      window.dispatchEvent(ev);
    });

  // init values
  el.tx && (el.tx.value = state.tx);
  el.ty && (el.ty.value = state.ty);
  el.rx && (el.rx.value = state.rx);
  el.ry && (el.ry.value = state.ry);
  el.rz && (el.rz.value = state.rz);

  el.sx && (el.sx.value = state.sx);
  el.sy && (el.sy.value = state.sy);
  el.sz && (el.sz.value = state.sz);

  el.su && (el.su.value = state.su);
  el.suv && (el.suv.textContent = scaleFromSlider(state.su).toFixed(2));

  el.uScale && (el.uScale.checked = state.uniformScale);
  if (state.uniformScale) {
    el.sx?.setAttribute("disabled", "disabled");
    el.sy?.setAttribute("disabled", "disabled");
    el.sz?.setAttribute("disabled", "disabled");
  }
  el.keepView && (el.keepView.checked = state.keepView);

  const orderInit = el.orderRadios.find((r) => r.value === state.order);
  orderInit && (orderInit.checked = true);

  const pr = el.projectionRadios.find((r) => r.value === state.projection);
  pr && (pr.checked = true);

  // NEW: shading init (state.shading → radio işaretle)
  const sh = el.shadingRadios.find((r) => r.value === state.shading);
  sh && (sh.checked = true);

  el.near &&
    (el.near.value = invLogLerp(
      state.near,
      NEAR_MIN,
      NEAR_MAX,
      NEAR_SL_MIN,
      NEAR_SL_MAX
    ));
  el.far &&
    (el.far.value = invLogLerp(
      state.far,
      FAR_MIN,
      FAR_MAX,
      FAR_SL_MIN,
      FAR_SL_MAX
    ));

  el.fov && el.fovv && (el.fovv.textContent = Math.round(state.fov));
  el.orthoSize &&
    el.orthoSizev &&
    ((el.orthoSize.value = state.orthoSize),
    (el.orthoSizev.textContent = state.orthoSize.toFixed(1)));

  updateInsetButton();
  applyProjectionParamEnables();
  ensureNearFarConsistency();
  syncLabels();
}

export function getTRS() {
  return { ...state };
}
export function initUI() {
  bind();
  buildMatrixHUD();
}

export { SCALE_BASE, scaleFromSlider };
