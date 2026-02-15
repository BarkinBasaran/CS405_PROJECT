// js/terrain.js
// Phase 3: Heightmap Terrain Generation (WebGL1-friendly)
// No external libraries.

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function fade(t) {
  // 6t^5 - 15t^4 + 10t^3
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + t * (b - a);
}

const GRADS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

export class Perlin2D {
  constructor(seed = 1234) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    // Fisher-Yates shuffle
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }

    // Duplicate for overflow
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  grad(hash, x, y) {
    const g = GRADS[hash & 7];
    return g[0] * x + g[1] * y;
  }

  noise(x, y) {
    // Classic 2D gradient Perlin noise in [-1, 1]
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = fade(xf);
    const v = fade(yf);

    const aa = this.perm[this.perm[xi] + yi];
    const ab = this.perm[this.perm[xi] + yi + 1];
    const ba = this.perm[this.perm[xi + 1] + yi];
    const bb = this.perm[this.perm[xi + 1] + yi + 1];

    const x1 = lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
    const x2 = lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u);

    return lerp(x1, x2, v);
  }
}

export function generateHeightmapProcedural(res, {
  seed = 1,
  octaves = 5,
  persistence = 0.5,
  lacunarity = 2.0,
  noiseScale = 2.5,
} = {}) {
  const perlin = new Perlin2D(seed);

  const heights = new Float32Array(res * res);

  let minV = Infinity;
  let maxV = -Infinity;

  // Sample in [0,1] grid, but scale to noise domain.
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const nx = x / (res - 1);
      const nz = z / (res - 1);

      let amp = 1.0;
      let freq = 1.0;
      let sum = 0.0;
      let norm = 0.0;

      for (let i = 0; i < octaves; i++) {
        const sx = nx * freq * noiseScale;
        const sz = nz * freq * noiseScale;
        sum += amp * perlin.noise(sx, sz);
        norm += amp;
        amp *= persistence;
        freq *= lacunarity;
      }

      const v = sum / (norm || 1.0); // ~[-1,1]
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);

      heights[z * res + x] = v;
    }
  }

  // Normalize into [0,1]
  const range = maxV - minV || 1.0;
  for (let i = 0; i < heights.length; i++) {
    heights[i] = (heights[i] - minV) / range;
  }
  return heights;
}

export async function generateHeightmapFromImage(fileOrBlob, res, weights = { a: 0.299, b: 0.587, c: 0.114 }) {
  const img = await loadImageFromFile(fileOrBlob);

  const cvs = document.createElement("canvas");
  cvs.width = res;
  cvs.height = res;
  const ctx = cvs.getContext("2d");

  // Draw scaled to current resolution
  ctx.drawImage(img, 0, 0, res, res);

  const data = ctx.getImageData(0, 0, res, res).data;
  const heights = new Float32Array(res * res);

  const a = weights.a, b = weights.b, c = weights.c;

  for (let i = 0; i < res * res; i++) {
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const bl = data[i * 4 + 2];
    // grayscale in [0,1]
    heights[i] = (a * r + b * g + c * bl) / 255.0;
  }
  return heights;
}

function loadImageFromFile(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function normalize3(x, y, z) {
  const L = Math.hypot(x, y, z) || 1.0;
  return [x / L, y / L, z / L];
}

export function buildTerrainMesh(heights01, res, terrainSize, heightScale) {
  const positions = new Float32Array(res * res * 3);
  const normals = new Float32Array(res * res * 3);

  const cellSize = terrainSize / (res - 1);

  let minY = Infinity;
  let maxY = -Infinity;

  // Positions
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const h = heights01[z * res + x] * heightScale;
      const px = x * cellSize - terrainSize / 2;
      const py = h;
      const pz = z * cellSize - terrainSize / 2;

      const idx = (z * res + x) * 3;
      positions[idx + 0] = px;
      positions[idx + 1] = py;
      positions[idx + 2] = pz;

      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }

  // Normals via central differences (clamped)
  const getH = (x, z) => {
    x = Math.max(0, Math.min(res - 1, x));
    z = Math.max(0, Math.min(res - 1, z));
    return heights01[z * res + x] * heightScale;
  };

  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const hL = getH(x - 1, z);
      const hR = getH(x + 1, z);
      const hD = getH(x, z - 1);
      const hU = getH(x, z + 1);

      const nx = (hL - hR);
      const nz = (hD - hU);
      const ny = 2.0 * cellSize;

      const [nnx, nny, nnz] = normalize3(nx, ny, nz);
      const idx = (z * res + x) * 3;
      normals[idx + 0] = nnx;
      normals[idx + 1] = nny;
      normals[idx + 2] = nnz;
    }
  }

  // Indices (Uint16 for WebGL1) - keep res <= 200 in UI
  const quadCount = (res - 1) * (res - 1);
  const indices = new Uint16Array(quadCount * 6);
  let k = 0;
  for (let z = 0; z < res - 1; z++) {
    for (let x = 0; x < res - 1; x++) {
      const topLeft = z * res + x;
      const topRight = topLeft + 1;
      const bottomLeft = (z + 1) * res + x;
      const bottomRight = bottomLeft + 1;

      // (topLeft, bottomLeft, topRight)
      indices[k++] = topLeft;
      indices[k++] = bottomLeft;
      indices[k++] = topRight;

      // (topRight, bottomLeft, bottomRight)
      indices[k++] = topRight;
      indices[k++] = bottomLeft;
      indices[k++] = bottomRight;
    }
  }

  return { positions, normals, indices, minY, maxY, cellSize };
}
