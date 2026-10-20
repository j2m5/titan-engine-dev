import { Color, ShaderChunk, Uniform, Vector3 } from 'three'
import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'
import { starSurface } from '@/core/materials/shaders/lib/chunks/StarSurface'
import { STAR_CORE_INTENSITY, STAR_LIMB_COEFF } from '@/core/materials/shaders/lib/helpers'

/**
 * Билборд дальней звезды (LOD-уровень 2, см. FakeStar): псевдосфера на
 * кваде с ТЕМИ ЖЕ формулами поверхности, что у диска — общий чанк
 * starSurface, общие константы яркости/лимба, та же палитра. Паттерн
 * BlackHoleImpostor: на дистанции переключения уровни совпадают по средней
 * яркости, цвету, bloom и бликам.
 *
 * Ячейки грануляции НЕ совпадают с диском попиксельно (квад смотрит в
 * камеру, сфера — в мировых осях): на 12px достаточно совпадения масштаба
 * (домен uRadius * 0.05 — тот же, что vPosition * 0.05 у диска при
 * |vPosition| = R), контраста и скорости эволюции (uTime с общим
 * множителем).
 *
 * Logdepthbuf-чанки обязательны: рендерер работает с логарифмической
 * глубиной (three.renderer.logarithmicDepthBuffer), без них depthTest
 * билборда разъезжается с глубиной остальной сцены (прецедент —
 * BlackHoleImpostorShaderTemplate).
 *
 * tonemapping_fragment/colorspace_fragment отсутствуют НАМЕРЕННО: рендер
 * идёт в линейный таргет композера, и тонмапом/кодированием владеет
 * пост-пайплайн (AgX-эффект) — прецедент BlackHoleImpostorShaderTemplate.
 * У диска (StarShaderTemplate) эти чанки — no-op при NoToneMapping.
 */
export const FakeStarShaderTemplate: ShaderProps = {
  uniforms: {
    uColorCool: new Uniform(new Color()),
    uColorBase: new Uniform(new Color()),
    uColorHot: new Uniform(new Color()),
    uCoreIntensity: new Uniform(STAR_CORE_INTENSITY),
    uLimbCoeff: new Uniform(new Vector3(...STAR_LIMB_COEFF)),
    uGranulation: new Uniform(1),
    uGlowGain: new Uniform(1),
    uRadius: new Uniform(1),
    uTime: new Uniform(0)
  },
  vertexShader: `
    varying vec2 vUv;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 uColorCool;
    uniform vec3 uColorBase;
    uniform vec3 uColorHot;
    uniform float uCoreIntensity;
    uniform vec3 uLimbCoeff;
    uniform float uGranulation;
    uniform float uGlowGain;
    uniform float uRadius;
    uniform float uTime;

    varying vec2 vUv;

    ${noiseFunctions}
    ${starSurface}

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      vec2 c = vUv * 2.0 - 1.0;
      float r = length(c);

      // Псевдосфера: mu — косинус к взгляду (вход лимба), он же z-подъём
      // точки шума на «купол», чтобы ячейки не растягивались к кромке
      float mu = sqrt(max(1.0 - r * r, 0.0));

      // Домен шума диска при |vPosition| = R — та же формула, тот же масштаб
      vec3 noiseDomain = vec3(c, mu) * uRadius * 0.05;

      // ВСЕ производные — ДО ветвления, в равномерном потоке управления
      // (WebGL2, деривативы в ядре): AA-кромка и экранный масштаб зерна.
      // Билборд живёт на STAR_IMPOSTOR_PIXELS, где грануляция уже погашена,
      // как и у диска на дистанции переключения.
      // Полоса AA центрирована на r = 1: сглаживание только внутрь съедало
      // площадь 12px-диска и 20–27% его энергии на переходе со сферы.
      // Минимальная ширина сохраняет строгий порядок границ smoothstep
      // даже в центре симметричного пиксельного квада, где fwidth(r) = 0.
      float edgeWidth = max(0.5 * fwidth(r), 1e-6);
      float alpha = 1.0 - smoothstep(1.0 - edgeWidth, 1.0 + edgeWidth, r);
      float domainPerPixel = starDomainPerPixel(noiseDomain);

      if (alpha <= 0.0) {
        gl_FragColor = vec4(0.0);
        return;
      }

      vec3 radiance = starGranulationRadiance(vec4(noiseDomain, uTime), uGranulation, domainPerPixel,
                                            uColorCool, uColorBase, uColorHot, uCoreIntensity);
      vec3 limb = starLimb(mu, uLimbCoeff);

      // uGlowGain — свечение издалека, общий объект с диском (StarLod).
      // Потолок HDR — тот же, что у диска и атмосферы
      vec3 color = min(radiance * limb * uGlowGain, vec3(64.0));

      gl_FragColor = vec4(color, alpha);
    }
  `
}
