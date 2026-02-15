precision mediump float;

varying vec3 v_worldPos;
varying vec3 v_worldNrm;
varying vec3 v_tint;

uniform vec3 u_lightDir;    // world-space, yüzeyden ışığa
uniform vec3 u_cameraPos;   // world-space kamera pozisyonu
uniform vec3 u_baseColor;   // temel obje rengi
uniform vec3 u_ambient;     // ortam ışığı
uniform int  u_levels;      // ışık bandı sayısı (3,4 vs.)

void main() {
  vec3 N = normalize(v_worldNrm);
  vec3 L = normalize(u_lightDir);
  vec3 V = normalize(u_cameraPos - v_worldPos);

  float ndotl = max(dot(N, L), 0.0);

  // --- Toon (cel) shading: ndotl'ı bandlara böl ---
  float bands = float(u_levels);
  // örn. levels=3 -> [0, 0.5, 1.0] gibi
  float q = floor(ndotl * bands) / (bands - 1.0);

  vec3 base = u_baseColor * v_tint;

  // Diffuse + ambient (quantized)
  vec3 col = u_ambient + q * base;

  // Hafif rim light (silüet parlaklığı)
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  col += rim * 0.25 * base;

  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
