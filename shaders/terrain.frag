// shaders/terrain.frag
precision mediump float;

varying vec3 v_n;
varying float v_t;

uniform vec3 u_lightDir;
uniform float u_ambient;
uniform float u_diffuse;
uniform int u_colorMode; // 0=gradient, 1=grayscale

vec3 heightGradient(float t) {
  // low: deep blue -> mid: green -> high: brown -> top: white
  vec3 deep = vec3(0.05, 0.12, 0.40);
  vec3 green = vec3(0.10, 0.55, 0.18);
  vec3 brown = vec3(0.45, 0.32, 0.18);
  vec3 white = vec3(0.92, 0.92, 0.92);

  if (t < 0.35) {
    float u = t / 0.35;
    return mix(deep, green, u);
  } else if (t < 0.70) {
    float u = (t - 0.35) / 0.35;
    return mix(green, brown, u);
  } else {
    float u = (t - 0.70) / 0.30;
    return mix(brown, white, u);
  }
}

void main() {
  vec3 N = normalize(v_n);
  vec3 L = normalize(u_lightDir);
  float ndl = max(0.0, dot(N, L));

  vec3 base;
  if (u_colorMode == 1) {
    base = vec3(v_t);
  } else {
    base = heightGradient(v_t);
  }

  float shade = u_ambient + ndl * u_diffuse;
  vec3 col = base * shade;

  gl_FragColor = vec4(col, 1.0);
}
