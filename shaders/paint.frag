// shaders/paint.frag
precision mediump float;

varying vec3 v_worldPos;
varying vec3 v_worldNrm;
varying vec3 v_tint;

uniform vec3 u_lightDir;
uniform vec3 u_cameraPos;
uniform vec3 u_baseColor;
uniform vec3 u_ambient;

// Basit hash – stroke/noise için
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Basit “fırça darbesi” deseni
float strokePattern(vec2 p) {
  // dünya xz düzleminde çalışalım
  vec2 q = p * 4.0;
  vec2 cell = floor(q);
  float h = hash(cell);

  // y yönünde fırça izleri
  float stripe = fract(q.y + h * 0.73);
  float s = smoothstep(0.15, 0.5, stripe) * (1.0 - smoothstep(0.5, 0.85, stripe));

  // biraz varyasyon
  float s2 = smoothstep(0.1, 0.6, fract(q.x * 0.7 + h * 1.9));
  return mix(s, s2, 0.4);
}

void main() {
  vec3 N = normalize(v_worldNrm);
  vec3 L = normalize(u_lightDir);
  vec3 V = normalize(u_cameraPos - v_worldPos);

  // Lambert
  float ndotl = max(dot(N, L), 0.0);

  // Toon benzeri quantize ama tamamen kararmasın:
  float levels = 4.0;
  float q = floor(ndotl * levels) / (levels - 1.0);
  // minimum parlaklık: 0.18 → hiçbir açıdan full siyah olmayacak
  float shade = max(q, 0.18);

  // Temel renk
  vec3 baseCol = u_baseColor * v_tint;

  // Fırça efekti: dünya xz pozisyonu üzerinden
  float strokes = strokePattern(v_worldPos.xz);
  // Fırçayı ışıkla biraz ilişkilendir (karanlıkta daha zayıf, aydınlıkta daha güçlü)
  float strokeStrength = mix(0.3, 1.0, ndotl);
  float strokeScale = 0.8 + strokeStrength * (strokes * 0.6); // 0.8–1.4 arası

  vec3 col = baseCol;

  // Ambient + quantize edilmiş diffuse
  col *= (u_ambient + shade * 1.2);

  // Fırça modülasyonu
  col *= strokeScale;

  // Hafif rim light (kontür hissi, kaybolmasın)
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += rim * 0.25 * vec3(1.0, 0.95, 0.9);

  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
