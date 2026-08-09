import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, Matrix3, ShaderChunk, Uniform } from 'three'

/**
 * Импостор карлика. Юниформы — надмножество юниформов диска: собственного
 * множителя яркости нет НАМЕРЕННО, поверхность считается тем же полем bdField
 * с теми же параметрами, что и у диска (без параллакса — см. ниже). Любая
 * своя ручка воссоздала бы шов на переключении LOD.
 *
 * uBodyRotation переводит нормаль псевдосферы из системы билборда в систему
 * тела: рисунок обязан оставаться прибитым к карлику и на импосторе тоже.
 * Именно билборда, а не камеры — квад развёрнут через lookAt на камеру, и его
 * ориентация совпадает с ориентацией камеры только на оси взгляда.
 */
export const BrownDwarfImpostorShaderTemplate: ShaderProps = {
  uniforms: {
    uColorCloud: new Uniform(new Color()),
    uColorCloudHigh: new Uniform(new Color()),
    uColorHot: new Uniform(new Color()),
    uColorHotDeep: new Uniform(new Color()),
    uOpticalDepth: new Uniform(3),
    uGapGlow: new Uniform(3.3),
    uLimbDarkening: new Uniform(0.6),
    uGapThreshold: new Uniform(0.42),
    uDeckSoftness: new Uniform(0.04),
    uBreathAmplitude: new Uniform(0.08),
    uSeed: new Uniform(4096),
    uBandCount: new Uniform(4.5),
    uTurbulence: new Uniform(1.6),
    uBandWarp: new Uniform(0.16),
    uZonalShear: new Uniform(0.5),
    uFineDetail: new Uniform(0.25),
    uPolarChaos: new Uniform(0.8),
    uVortexStrength: new Uniform(0.35),
    time: new Uniform(0),
    uBodyRotation: new Uniform(new Matrix3())
  },
  vertexShader: `
    varying vec2 vQuadUv;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      vQuadUv = uv * 2.0 - 1.0;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 uColorCloud;
    uniform vec3 uColorCloudHigh;
    uniform vec3 uColorHot;
    uniform vec3 uColorHotDeep;
    uniform float uOpticalDepth;
    uniform float uGapGlow;
    uniform float uLimbDarkening;
    uniform float uGapThreshold;
    uniform float uDeckSoftness;
    uniform float uBreathAmplitude;
    uniform float uSeed;
    uniform float uBandCount;
    uniform float uTurbulence;
    uniform float uBandWarp;
    uniform float uZonalShear;
    uniform float uFineDetail;
    uniform float uPolarChaos;
    uniform float uVortexStrength;
    uniform float time;
    uniform mat3 uBodyRotation;

    varying vec2 vQuadUv;

    #include <noiseFunctions>
    #include <starSurface>
    #include <brownDwarfSurface>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      float r = length(vQuadUv);

      // AA-кромка по экранной производной — тот же приём, что у FakeStar:
      // discard режет по пиксельной сетке и MSAA композера её не сглаживает,
      // а силуэт LOD-0 (геометрия сферы) сглаживается — без этого на стыке
      // LOD менялось бы качество кромки. fwidth — ДО ветвления
      float alpha = 1.0 - smoothstep(1.0 - fwidth(r) * 1.5, 1.0, r);
      if (alpha <= 0.0) {
        gl_FragColor = vec4(0.0);
        return;
      }

      // Псевдосфера: нормаль восстанавливается из позиции внутри квада,
      // mu — она же по построению (взгляд вдоль -Z экрана)
      vec3 normalView = vec3(vQuadUv, sqrt(max(1.0 - r * r, 0.0)));
      float mu = normalView.z;

      // Перевод в систему тела: рисунок остаётся прибитым к карлику
      vec3 dir = normalize(uBodyRotation * normalView);

      // Без параллакса: при видимом размере 12px сдвиг верхушки суб-пиксельный,
      // второй вызов поля добавил бы только стоимость без видимого эффекта
      vec3 field = bdField(dir, uSeed, uBandCount, uTurbulence, uGapThreshold, uDeckSoftness, uBandWarp, uZonalShear, uFineDetail, uPolarChaos, uVortexStrength);

      // Та же точка входа и тот же список аргументов, что у диска —
      // закреплено тестом посимвольного сравнения вызова
      vec3 color = bdShade(field, mu, dir, uColorCloud, uColorCloudHigh, uColorHot, uColorHotDeep,
                           uOpticalDepth, uGapGlow, uLimbDarkening, time, uBreathAmplitude);

      gl_FragColor = vec4(color, alpha);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
