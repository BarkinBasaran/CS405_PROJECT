// shaders/terrain.vert
attribute vec3 a_pos;
attribute vec3 a_nrm;

uniform mat4 u_MVP;
uniform mat4 u_M;
uniform float u_hMin;
uniform float u_hMax;

varying vec3 v_n;
varying float v_t;

void main() {
  vec3 n = mat3(u_M) * a_nrm;
  v_n = n;

  float denom = max(0.0001, (u_hMax - u_hMin));
  v_t = clamp((a_pos.y - u_hMin) / denom, 0.0, 1.0);

  gl_Position = u_MVP * vec4(a_pos, 1.0);
}
