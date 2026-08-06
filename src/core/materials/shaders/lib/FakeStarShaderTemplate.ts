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
 */
export const FakeStarShaderTemplate: ShaderProps = {
  uniforms: {
    uColorCool: new Uniform(new Color()),
    uColorBase: new Uniform(new Color()),
    uColorHot: new Uniform(new Color()),
    uCoreIntensity: new Uniform(STAR_CORE_INTENSITY),
    uLimbCoeff: new Uniform(new Vector3(...STAR_LIMB_COEFF)),
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
    uniform float uRadius;
    uniform float uTime;

    varying vec2 vUv;

    ${noiseFunctions}
    ${starSurface}

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      vec2 c = vUv * 2.0 - 1.0;
      float r = length(c);

      // AA-кромка по экранной производной; fwidth — ДО ветвления, в
      // равномерном потоке управления (WebGL2, деривативы в ядре)
      float alpha = 1.0 - smoothstep(1.0 - fwidth(r) * 1.5, 1.0, r);
      if (alpha <= 0.0) {
        gl_FragColor = vec4(0.0);
        return;
      }

      // Псевдосфера: mu — косинус к взгляду (вход лимба), он же z-подъём
      // точки шума на «купол», чтобы ячейки не растягивались к кромке
      float mu = sqrt(max(1.0 - r * r, 0.0));

      float t = starGranulationT(vec4(vec3(c, mu) * uRadius * 0.05, uTime));
      vec3 granule = starGranuleColor(t, uColorCool, uColorBase, uColorHot);
      float energy = starEnergy(t, uCoreIntensity);
      vec3 limb = starLimb(mu, uLimbCoeff);

      // Потолок HDR — тот же, что у диска и атмосферы
      vec3 color = min(granule * energy * limb, vec3(64.0));

      gl_FragColor = vec4(color, alpha);
    }
  `
}
