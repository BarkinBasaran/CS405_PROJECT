precision mediump float;

varying vec3 v_worldPos;
varying vec3 v_worldNrm;
varying vec3 v_tint;

uniform mat4 u_V;
uniform mat4 u_P;
uniform mat4 u_invV;
uniform mat4 u_invVP;

uniform float u_IOR;
uniform float u_absorb;
uniform float u_refBoost;

// --- reuse sky environment ---
float hash1(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float stars(vec3 dir) {
  float d = hash1(floor(dir * 1024.0));
  float s = smoothstep(0.992, 1.0, d);
  return s * s * 1.5;
}
vec3 spaceColor(vec3 dir) {
  float band = pow(max(0.0, 1.0 - abs(dir.y)), 3.0);
  vec3 nebula = mix(vec3(0.04, 0.06, 0.12), vec3(0.06, 0.09, 0.18), band);
  float st = stars(dir);
  vec3 col = nebula + st * vec3(1.2, 1.2, 1.3);
  return col * 1.35;
}

vec3 viewDirWorld(vec3 worldPos) {
  vec3 camPos = (u_invV * vec4(0.0,0.0,0.0,1.0)).xyz;
  return normalize(camPos - worldPos);
}
// --- önceki kodlar aynı kalıyor ---

void main() {
  vec3 N = normalize(v_worldNrm);
  vec3 V = viewDirWorld(v_worldPos);

  float ior = max(1.0001, u_IOR);
  float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  float cosTheta = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
  fresnel = clamp(fresnel + u_refBoost * 1.5, 0.0, 1.0); // 1️⃣ daha güçlü yansıma

  // reflection / refraction
  vec3 R = reflect(-V, N);
  vec3 T = refract(-V, N, 1.0 / ior);
  bool tir = length(T) < 0.0001;

  vec3 envRef  = spaceColor(normalize(R)) * 1.9; // 2️⃣ parlak yansıma
  vec3 envRefr = spaceColor(normalize(T)) * 1.4; // 3️⃣ güçlü kırılma

  // daha az kararma
  float dist = 0.4;
  vec3 absorb = exp(-u_absorb * dist * (0.5 + 0.5 * v_tint));
  envRefr *= absorb;

  // rim light - kenar vurgusu
  float rim = pow(1.0 - cosTheta, 2.0) * 1.2; // 4️⃣ kenar vurgusu ciddi arttı

  vec3 col = mix(envRefr, envRef, tir ? 1.0 : fresnel);
  col *= (0.9 + 0.2 * v_tint);
  col += rim;
  col = mix(col, col + vec3(0.15, 0.15, 0.2), 0.4);

  // alpha daha yüksek - belirginlik artışı
  float alpha = mix(0.9, 1.0, fresnel);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
