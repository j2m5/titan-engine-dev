import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, Matrix3, ShaderChunk, Uniform } from 'three'

/**
 * Импостор карлика. Юниформы — надмножество юниформов диска: собственного
 * множителя яркости нет НАМЕРЕННО, поверхность считается теми же функциями
 * чанка brownDwarfSurface по той же кубмапе. Любая своя ручка воссоздала бы
 * шов на переключении LOD.
 *
 * uBodyRotation переводит нормаль псевдосферы из системы билборда в систему
 * тела: рисунок обязан оставаться прибитым к карлику и на импосторе тоже.
 * Именно билборда, а не камеры — квад развёрнут через lookAt на камеру, и его
 * ориентация совпадает с ориентацией камеры только на оси взгляда.
 */
export const BrownDwarfImpostorShaderTemplate: ShaderProps = {
  uniforms: {
    uClouds: new Uniform(null),
    uColorCloud: new Uniform(new Color()),
    uColorHot: new Uniform(new Color()),
    uOpticalDepth: new Uniform(3),
    uGapGlow: new Uniform(3),
    uParallax: new Uniform(0.02),
    uBreathAmplitude: new Uniform(0.08),
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

    uniform samplerCube uClouds;
    uniform vec3 uColorCloud;
    uniform vec3 uColorHot;
    uniform float uOpticalDepth;
    uniform float uGapGlow;
    uniform float uParallax;
    uniform float uBreathAmplitude;
    uniform float time;
    uniform mat3 uBodyRotation;

    varying vec2 vQuadUv;

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

      vec2 field = textureCube(uClouds, dir).rg;

      // Та же точка входа и тот же список аргументов, что у диска —
      // закреплено тестом посимвольного сравнения вызова
      vec3 color = bdShade(field, mu, dir, uColorCloud, uColorHot,
                           uOpticalDepth, uGapGlow, time, uBreathAmplitude);

      gl_FragColor = vec4(color, alpha);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
