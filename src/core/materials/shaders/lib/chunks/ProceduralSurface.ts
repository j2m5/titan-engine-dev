import { noiseFunctions } from './Noise'

/**
 * GLSL-зеркало proceduralField (см. src/core/terrain/proceduralSurfaceField.ts).
 * Сид сюда НЕ передаётся — CPU разворачивает его в uFieldOffset (паритет
 * держится на общем симплексе, не на хешах). Менять только синхронно с TS.
 */
export const proceduralFieldChunk = `
  uniform vec3 uFieldOffset;
  uniform float uFieldFrequency;
  uniform int uFieldOctaves;
  uniform float uFieldGain;
  uniform float uFieldLacunarity;
  uniform float uFieldContrast;

  float proceduralField(vec3 dir) {
    float amplitude = 1.0;
    float frequency = uFieldFrequency;
    float sum = 0.0;
    float norm = 0.0;
    for (int k = 0; k < 12; k++) {
      if (k >= uFieldOctaves) break;
      sum += amplitude * snoise(dir * frequency + uFieldOffset);
      norm += amplitude;
      amplitude *= uFieldGain;
      frequency *= uFieldLacunarity;
    }
    float v = sum / norm;
    return sign(v) * pow(abs(v), uFieldContrast);
  }
`

export const proceduralDiffuseVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/**
 * Полный экран → эквиректангулярный диффуз. Направление из uv — ОБРАТНАЯ
 * dirToUv (phi = atan2(z, -x), строка 0 карты = север): RT не проходит flipY,
 * поэтому верх таргета (vUv.y = 1) обязан быть севером — theta от (1 - v).
 * Палитра — кусочно-линейно по нормализованному полю [0,1]; пятнистость
 * альбедо — мелкая октава того же поля с 8-кратной частотой.
 */
export const proceduralDiffuseFragment = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uPalette[4];
  uniform float uAlbedoNoise;
  ${noiseFunctions}
  ${proceduralFieldChunk}

  void main() {
    float PI = 3.14159265358979;
    float theta = (1.0 - vUv.y) * PI;
    float phi = vUv.x * 2.0 * PI;
    vec3 dir = vec3(-sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));

    float h = proceduralField(dir) * 0.5 + 0.5;
    float t = clamp(h, 0.0, 1.0) * 3.0;
    int band = int(min(t, 2.0));
    vec3 color = mix(uPalette[band], uPalette[band + 1], fract(min(t, 2.999999)));

    float mottle = snoise(dir * uFieldFrequency * 8.0 + uFieldOffset) * 0.5;
    color *= 1.0 + uAlbedoNoise * mottle;

    gl_FragColor = vec4(color, 1.0);
  }
`
