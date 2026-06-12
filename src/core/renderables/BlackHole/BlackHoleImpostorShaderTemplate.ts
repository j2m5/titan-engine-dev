import { IUniform, ShaderChunk, Texture, Uniform, Vector2 } from 'three'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { BLACKBODY_GLSL } from '@/core/renderables/BlackHole/BlackHoleShaderChunks'

/**
 * Шейдер импостора аккреционного диска (LOD L1)
 *
 * Плоское кольцо в духе AccretionDiskV2, но с ТЕМИ ЖЕ blackbody-лукапом,
 * профилем Шакуры–Сюняева, интенсивностью и noise-текстурой, что у L0 —
 * палитры уровней совпадают на дистанции переключения (§8 спецификации).
 * Доплер-асимметрия запечена статическим азимутальным градиентом яркости:
 * на пороговом экранном размере (~35 px) неотличима от честной.
 * Лензированные дуги не воспроизводятся — на этом размере нечитаемы.
 *
 * Внутренний край эмитит HDR > 1: далёкая дыра продолжает сиять Bloom'ом,
 * без «гашения» при отлёте. Встроенный пайплайн глубины (ShaderMaterial +
 * logdepthbuf-чанки, renderer.logarithmicDepthBuffer = true)
 */
export function createBlackHoleImpostorUniforms(parameters: BlackHoleParameters): Record<string, IUniform> {
  return {
    uDiskTemperature: new Uniform(parameters.temperature),
    uDiskIntensity: new Uniform(parameters.diskIntensity),
    uDopplerStrength: new Uniform(parameters.dopplerStrength),
    uNoiseScale: new Uniform(parameters.diskNoiseScale),
    uNoiseOffset: new Uniform(new Vector2()),
    noiseMap: new Uniform<Texture | null>(null),

    /** Перевод: объектные единицы Three.js → единицы rsVisual */
    uInvRsUnits: new Uniform(1 / parameters.rsVisualUnits),
    uInnerRs: new Uniform(parameters.diskInnerRs),
    uOuterRs: new Uniform(parameters.diskOuterRs),

    /** Время симуляции (дни, свёрнутые на CPU) и период внутреннего края */
    uTime: new Uniform(0),
    uRotationPeriod: new Uniform(Math.max(parameters.rotationPeriod, 1e-3))
  }
}

export const BlackHoleImpostorShaderTemplate = {
  vertexShader: /* glsl */ `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    varying vec2 vLocal;

    void main() {
      // координаты в плоскости кольца ДО поворота меша — азимут и радиус
      // считаются в локальной системе, согласованной с базисом диска L0
      vLocal = position.xy;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: /* glsl */ `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform float uDiskTemperature;
    uniform float uDiskIntensity;
    uniform float uDopplerStrength;
    uniform float uNoiseScale;
    uniform vec2 uNoiseOffset;
    uniform sampler2D noiseMap;
    uniform float uInvRsUnits;
    uniform float uInnerRs;
    uniform float uOuterRs;
    uniform float uTime;
    uniform float uRotationPeriod;

    varying vec2 vLocal;

    const float TWO_PI = 6.28318530718;

    ${BLACKBODY_GLSL}

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      float rc = length(vLocal) * uInvRsUnits;
      float theta = atan(vLocal.y, vLocal.x);
      float turns = theta / TWO_PI + 0.5;

      // та же турбулентность, что у L0; один слой без антинамоточного
      // кроссфейда — на пороговом размере намотка неразличима
      float omega = TWO_PI / uRotationPeriod * pow(rc / uInnerRs, -1.5);
      float x = turns - uTime * omega / TWO_PI;
      vec2 uv = vec2(x * 3.0, log(rc) * 5.0 * uNoiseScale) + uNoiseOffset;
      float n = texture2D(noiseMap, uv).r * 0.62
              + texture2D(noiseMap, uv * vec2(2.0, 2.3) + vec2(0.37, 0.71)).g * 0.38;

      float edge = smoothstep(uInnerRs, uInnerRs * 1.25, rc)
                 * (1.0 - smoothstep(uOuterRs * 0.78, uOuterRs, rc));

      // Шакура–Сюняев + грав. покраснение — формулы L0
      float temperature = uDiskTemperature * pow(rc / uInnerRs, -0.75);
      float gravShift = sqrt(max(1.0 - 1.0 / rc, 0.0));

      // статически запечённый доплер: азимутальный градиент яркости,
      // ориентация согласована с tangentX базиса L0
      float beaming = pow(1.0 + 0.5 * uDopplerStrength * cos(theta), 3.0);

      vec3 color = blackbody(temperature * gravShift)
                 * uDiskIntensity
                 * pow(uInnerRs / rc, 2.2)
                 * beaming * gravShift * gravShift
                 * (0.4 + 0.8 * n);

      float alpha = clamp(edge * (0.35 + 0.85 * n), 0.0, 1.0) * 0.85 + 0.1 * edge;

      gl_FragColor = vec4(color, alpha);
    }
  `
}
