export const BEZ_SEG = 64;

export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
export function mix(a, b, t) {
  return a + (b - a) * t;
}

// P: [[x0,y0], [x1,y1], [x2,y2], [x3,y3]]
export function isValidCtrl(P) {
  return (
    Array.isArray(P) &&
    P.length === 4 &&
    P.every(
      (v) =>
        Array.isArray(v) &&
        v.length === 2 &&
        Number.isFinite(v[0]) &&
        Number.isFinite(v[1])
    )
  );
}

// --------------------------------------------------------
// Değerlendirme (Bernstein temelli)
// --------------------------------------------------------
export function cubicPoint(t, P) {
  t = clamp(t, 0, 1);
  if (!isValidCtrl(P)) throw new Error("cubicPoint: invalid control points");

  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;

  const x = b0 * P[0][0] + b1 * P[1][0] + b2 * P[2][0] + b3 * P[3][0];
  const y = b0 * P[0][1] + b1 * P[1][1] + b2 * P[2][1] + b3 * P[3][1];
  return [x, y];
}

// Birinci türev B'(t) (tanjant vektörü; normalize etmeden döner)
export function cubicTangent(t, P) {
  t = clamp(t, 0, 1);
  if (!isValidCtrl(P)) throw new Error("cubicTangent: invalid control points");

  const u = 1 - t;
  // B'(t) = 3*( (P1-P0)*u^2 + 2*(P2-P1)*u*t + (P3-P2)*t^2 )
  const p10x = P[1][0] - P[0][0],
    p10y = P[1][1] - P[0][1];
  const p21x = P[2][0] - P[1][0],
    p21y = P[2][1] - P[1][1];
  const p32x = P[3][0] - P[2][0],
    p32y = P[3][1] - P[2][1];

  const sx = p10x * (u * u) + 2 * p21x * u * t + p32x * (t * t);
  const sy = p10y * (u * u) + 2 * p21y * u * t + p32y * (t * t);
  return [3 * sx, 3 * sy];
}

// Normalleştirme ve açı (2D için)
export function length2(v) {
  return Math.hypot(v[0], v[1]);
}
export function normalize2(v) {
  const L = length2(v);
  return L > 1e-8 ? [v[0] / L, v[1] / L] : [1, 0];
}
// Frenet benzeri: pos, tan (birim), normal (birim), açı (radyan; atan2)
export function evalFrenet2D(t, P) {
  const pos = cubicPoint(t, P);
  const tan = normalize2(cubicTangent(t, P));
  const nor = [-tan[1], tan[0]];
  const ang = Math.atan2(tan[1], tan[0]); // x-eksenine göre
  return { pos, tan, nor, ang };
}

// --------------------------------------------------------
// Çizim veri üretimi
// --------------------------------------------------------
// Eğri polilinesi (LINE_STRIP için): [x,y,0] dizisi döner
export function buildPolyline(P, seg = BEZ_SEG, z = 0) {
  seg = Math.max(1, seg | 0);
  const out = new Float32Array((seg + 1) * 3);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const [x, y] = cubicPoint(t, P);
    out[i * 3 + 0] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

// Kontrol noktalarını POINTS/LINES için Float32Array'e çevir
export function controlToFloat32(P, z = 0) {
  if (!isValidCtrl(P))
    throw new Error("controlToFloat32: invalid control points");
  return new Float32Array([
    P[0][0],
    P[0][1],
    z,
    P[1][0],
    P[1][1],
    z,
    P[2][0],
    P[2][1],
    z,
    P[3][0],
    P[3][1],
    z,
  ]);
}

// Kontrol çokgeni (P0-P1, P1-P2, P2-P3) için line list
export function controlPolygonLines(P, z = 0) {
  if (!isValidCtrl(P))
    throw new Error("controlPolygonLines: invalid control points");
  return new Float32Array([
    P[0][0],
    P[0][1],
    z,
    P[1][0],
    P[1][1],
    z,
    P[1][0],
    P[1][1],
    z,
    P[2][0],
    P[2][1],
    z,
    P[2][0],
    P[2][1],
    z,
    P[3][0],
    P[3][1],
    z,
  ]);
}

export function polylineLengthXY(arr /* Float32Array of [x,y,0] */) {
  let L = 0;
  for (let i = 3; i < arr.length; i += 3) {
    const dx = arr[i] - arr[i - 3];
    const dy = arr[i + 1] - arr[i - 2];
    L += Math.hypot(dx, dy);
  }
  return L;
}

// P üzerinde [0,1] t bölgesinde, seg örnekle LUT döndür ( [{t, s}] )
export function buildArcLengthLUT(P, seg = 200) {
  seg = Math.max(4, seg | 0);
  const pts = buildPolyline(P, seg);
  const lut = [];
  let acc = 0;
  lut.push({ t: 0, s: 0 });

  for (let i = 3, k = 1; i < pts.length; i += 3, k++) {
    const dx = pts[i] - pts[i - 3];
    const dy = pts[i + 1] - pts[i - 2];
    acc += Math.hypot(dx, dy);
    lut.push({ t: k / seg, s: acc });
  }
  // normalize 0..1 (s)
  const total = acc > 1e-8 ? acc : 1.0;
  for (const e of lut) e.s /= total;

  return { lut, totalLength: acc };
}

// s∈[0,1] → yaklaşık t (LUT üzerinde ikili arama + linear interp)
export function arcLengthToT(s, lutObj) {
  s = clamp(s, 0, 1);
  const lut = lutObj.lut || lutObj; // kabul et: doğrudan array de verilebilir
  let lo = 0,
    hi = lut.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lut[mid].s < s) lo = mid;
    else hi = mid;
  }
  const a = lut[lo],
    b = lut[hi];
  const t = (s - a.s) / Math.max(1e-8, b.s - a.s);
  return mix(a.t, b.t, clamp(t, 0, 1));
}

// --------------------------------------------------------
// 2D eğriyi 3B düzleme yerleştirme
// --------------------------------------------------------
// plane: 'XY' | 'XZ' | 'YZ'
// offset: üçüncü eksen ofseti (ör. XY için z=offset)
// scale: istersen 2D koordinatı ölçekle (default 1)
export function lift2DTo3D(P2, plane = "XY", offset = 0, scale = 1) {
  const [x, y] = [P2[0] * scale, P2[1] * scale];
  switch (plane) {
    case "XY":
      return [x, y, offset];
    case "XZ":
      return [x, offset, y];
    case "YZ":
      return [offset, x, y];
    default:
      return [x, y, offset];
  }
}

// 3B poliline üret (eğriyi 3B düzleme taşır)
export function buildWorldPolyline(
  P,
  seg = BEZ_SEG,
  plane = "XZ",
  offset = 0,
  scale = 1
) {
  const out = new Float32Array((seg + 1) * 3);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p2 = cubicPoint(t, P);
    const [x, y, z] = lift2DTo3D(p2, plane, offset, scale);
    out[i * 3 + 0] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

// 3B’de teğet vektörü ve yön açısı (ör. XZ düzleminde heading=atan2(z', x'))
export function evalHeading3D(t, P, plane = "XZ") {
  const p2 = cubicPoint(t, P);
  const d2 = cubicTangent(t, P);
  const p3 = lift2DTo3D(p2, plane, 0, 1);
  let dir3;

  switch (plane) {
    case "XY":
      dir3 = [d2[0], d2[1], 0];
      break;
    case "YZ":
      dir3 = [0, d2[0], d2[1]];
      break;
    case "XZ":
    default:
      dir3 = [d2[0], 0, d2[1]];
      break;
  }
  const L = Math.hypot(dir3[0], dir3[1], dir3[2]) || 1;
  const n3 = [dir3[0] / L, dir3[1] / L, dir3[2] / L];

  // Heading: XZ için atan2(z, x), XY için atan2(y, x), YZ için atan2(z, y)
  let heading;
  if (plane === "XY") heading = Math.atan2(n3[1], n3[0]);
  else if (plane === "YZ") heading = Math.atan2(n3[2], n3[1]);
  else heading = Math.atan2(n3[2], n3[0]); // XZ default

  return { p3, n3, heading };
}
