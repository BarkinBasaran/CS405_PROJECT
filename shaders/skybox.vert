// Fullscreen quad (two triangles)
attribute vec2 a_pos;          // NDC quad: (-1,-1)..(1,1)
varying vec2 v_uv;
void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
