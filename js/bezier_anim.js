
// bezier_anim.js
// Reusable helpers + a tiny controller to animate a model along a cubic Bezier at constant speed.
// Column-major matrices expected. Adapt 'setModelMatrix' and 'getBezierControlPoints' to your app.

export function sToT(lut, s) {
  // Binary search on monotonically increasing arc-length samples [{t, s}] with s in [0,1]
  let lo = 0, hi = lut.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lut[mid].s < s) lo = mid + 1; else hi = mid - 1;
  }
  const i1 = Math.max(1, lo);
  const i0 = i1 - 1;
  const s0 = lut[i0].s, s1 = lut[i1].s;
  const t0 = lut[i0].t, t1 = lut[i1].t;
  const u = (s - s0) / Math.max(1e-6, (s1 - s0));
  return t0 + u * (t1 - t0);
}

export function bezierEval(P0,P1,P2,P3,t) {
  const u = 1 - t, uu = u*u, tt = t*t;
  return [
    uu*u*P0[0] + 3*uu*t*P1[0] + 3*u*tt*P2[0] + tt*t*P3[0],
    uu*u*P0[1] + 3*uu*t*P1[1] + 3*u*tt*P2[1] + tt*t*P3[1],
    uu*u*P0[2] + 3*uu*t*P1[2] + 3*u*tt*P2[2] + tt*t*P3[2],
  ];
}

export function bezierTangent(P0,P1,P2,P3,t) {
  // First derivative of cubic Bezier
  const u = 1 - t;
  const d = [
    3*u*u*(P1[0]-P0[0]) + 6*u*t*(P2[0]-P1[0]) + 3*t*t*(P3[0]-P2[0]),
    3*u*u*(P1[1]-P0[1]) + 6*u*t*(P2[1]-P1[1]) + 3*t*t*(P3[1]-P2[1]),
    3*u*u*(P1[2]-P0[2]) + 6*u*t*(P2[2]-P1[2]) + 3*t*t*(P3[2]-P2[2]),
  ];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0]/len, d[1]/len, d[2]/len];
}

export function cross(a,b){return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];}
export function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
export function normalize(v){const L=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/L,v[1]/L,v[2]/L];}

export function basisFromTangent(tan, up=[0,1,0]){
  let z = normalize(tan);
  // If z is nearly parallel to up, pick a different up to avoid degeneracy.
  if (Math.abs(dot(z, up)) > 0.99) up = [1,0,0];
  const x = normalize(cross(up, z));
  const y = normalize(cross(z, x));
  return {x, y, z};
}

// Build a column-major mat4 from orthonormal basis and position
export function mat4FromBasisPos(x,y,z, p){
  const m = new Float32Array(16);
  m[0]=x[0]; m[1]=x[1]; m[2]=x[2]; m[3]=0;
  m[4]=y[0]; m[5]=y[1]; m[6]=y[2]; m[7]=0;
  m[8]=z[0]; m[9]=z[1]; m[10]=z[2]; m[11]=0;
  m[12]=p[0]; m[13]=p[1]; m[14]=p[2]; m[15]=1;
  return m;
}

// ---- Tiny controller ----
// Usage:
//   const controller = createBezierAnimator({ getBezierControlPoints, lut, setModelMatrix });
//   controller.play(); // controller.stop();
export function createBezierAnimator({ getBezierControlPoints, lut, setModelMatrix, speed=0.25 }){
  let playing = false;
  let tStart  = 0;
  let rafId   = 0;

  function step(now){
    if (!playing) return;
    const elapsed = (now - tStart) * 0.001;   // seconds
    const s = (elapsed * speed) % 1.0;        // arc-length param
    const {P0,P1,P2,P3} = getBezierControlPoints();
    const t = sToT(lut, s);
    const pos = bezierEval(P0,P1,P2,P3,t);
    const tan = bezierTangent(P0,P1,P2,P3,t);
    const basis = basisFromTangent(tan);
    const M = mat4FromBasisPos(basis.x, basis.y, basis.z, pos);
    setModelMatrix(M);
    rafId = requestAnimationFrame(step);
  }

  return {
    play(){
      if (playing) return;
      playing = true; tStart = performance.now();
      rafId = requestAnimationFrame(step);
    },
    stop(){
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
    },
    isPlaying(){ return playing; }
  };
}
