attribute vec3 a_pos;
uniform mat4 u_V;
uniform mat4 u_P;
uniform float u_pointSize; // POINTS için
void main() {
  gl_Position = u_P * u_V * vec4(a_pos, 1.0);
  gl_PointSize = u_pointSize;
}
