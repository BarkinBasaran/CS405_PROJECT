attribute vec3 a_pos;
attribute vec3 a_col;
varying vec3 v_col;

uniform mat4 u_M;
uniform mat4 u_V;
uniform mat4 u_P;

void main() {
    v_col = a_col;
    gl_Position = u_P * u_V * u_M * vec4(a_pos, 1.0);
}
