attribute vec3 a_pos;
attribute vec3 a_nrm;
attribute vec3 a_col; // base tint per face (very subtle)

uniform mat4 u_M, u_V, u_P;

varying vec3 v_worldPos;
varying vec3 v_worldNrm;
varying vec3 v_tint;

void main() {
  vec4 worldPos = u_M * vec4(a_pos, 1.0);
  v_worldPos = worldPos.xyz;

  // normal transform (no non-uniform scale in M; if there is, use inverse-transpose)
  mat3 nmat = mat3(u_M);
  v_worldNrm = normalize(nmat * a_nrm);

  v_tint = a_col;
  gl_Position = u_P * u_V * worldPos;
}
