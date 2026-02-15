// shaders/skybox.frag
precision mediump float;
varying vec2 v_uv;

uniform mat4 u_invVP;

// 0 = space (glass)
// 1 = toon
// 2 = paint
uniform int u_bgMode;


// --------- yardımcılar ---------
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float stars(vec3 dir) {
  float d = hash3(floor(dir * 1024.0));
  float s = smoothstep(0.992, 1.0, d);
  return s * s * 1.5;
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}


// --------- 0) Uzay arka planı (Glass) ---------
vec3 spaceColor(vec3 dir) {
  float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

  vec3 top = vec3(0.02, 0.04, 0.10);
  vec3 bot = vec3(0.0, 0.0, 0.02);

  vec3 base = mix(bot, top, t);

  float st = stars(dir);
  base += vec3(1.0, 1.0, 1.0) * st;

  return base;
}


// --------- 1) Toon arka planı ---------
vec3 toonBg(vec3 dir) {
  float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

  // bandlara böl (toon hissi)
  float band = floor(t * 4.0 + 0.001) / 4.0;

  vec3 c1 = vec3(0.25, 0.45, 0.95);
  vec3 c2 = vec3(0.80, 0.90, 1.00);

  return mix(c1, c2, band);
}


// --------- 2) Paint arka planı ---------
vec3 paintBg(vec3 dir) {
  // XZ düzleminde radyal + gürültü
  vec2 p = dir.xz;
  float r = length(p);

  float n1 = hash2(p * 10.0);
  float n2 = hash2(p * 17.0 + 3.1);
  float noise = (n1 + n2) * 0.5;          // 0..1

  float falloff = exp(-r * r * 1.6);

  vec3 inner = vec3(0.95, 0.92, 0.86);
  vec3 outer = vec3(0.30, 0.22, 0.28);
  vec3 base = mix(outer, inner, falloff);

  // fırça efekti: hafif gürültü ile kır
  base += (noise - 0.5) * 0.15;

  return clamp(base, 0.0, 1.0);
}


// --------- main ---------
void main() {
  // ekran konumundan dünya yön vektörü üret
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec4 pN = vec4(ndc, 1.0, 1.0);
  vec4 world = u_invVP * pN;
  vec3 dir = normalize(world.xyz / world.w);

  vec3 col;
  if (u_bgMode == 1) {
    col = toonBg(dir);
  } else if (u_bgMode == 2) {
    col = paintBg(dir);
  } else {
    col = spaceColor(dir);
  }

  gl_FragColor = vec4(col, 1.0);
}
