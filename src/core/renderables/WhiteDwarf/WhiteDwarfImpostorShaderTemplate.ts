import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, Vector3 } from 'three'
import { STAR_CORE_INTENSITY } from '@/core/materials/shaders/lib/helpers'

/**
 * Билборд-импостор белого карлика (дальний LOD): псевдосфера на кваде, тот же
 * wdShade из чанка whiteDwarfSurface с тем же списком аргументов, что у диска.
 * Инвариант закреплён посимвольно в WhiteDwarfImpostor.spec.
 *
 * Шва на переключении здесь не может быть даже в принципе, в отличие от звезды
 * и коричневого карлика: у тех билборд и диск сэмплят шум в разных системах
 * координат и совпадают лишь по масштабу и контрасту. У белого карлика вся
 * поверхность — функция одного mu, а mu псевдосферы точен, а не приближён.
 *
 * Своего множителя яркости нет НАМЕРЕННО (тот же контракт, что у FakeStar).
 *
 * tonemapping_fragment/colorspace_fragment отсутствуют намеренно: рендер идёт в
 * линейный таргет композера, тонмапом владеет пост-пайплайн (прецедент —
 * FakeStarShaderTemplate и BlackHoleImpostorShaderTemplate).
 */
export const WhiteDwarfImpostorShaderTemplate: ShaderProps = {
  uniforms: {
    uColorBase: new Uniform(new Color()),
    uPlanckX: new Uniform(new Vector3()),
    uCoreIntensity: new Uniform(STAR_CORE_INTENSITY),
    uProximityExposure: new Uniform(1)
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

    uniform vec3 uColorBase;
    uniform vec3 uPlanckX;
    uniform float uCoreIntensity;
    uniform float uProximityExposure;

    varying vec2 vUv;

    #include <whiteDwarfSurface>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      vec2 c = vUv * 2.0 - 1.0;
      float r = length(c);

      // AA-кромка по экранной производной; fwidth — ДО ветвления, в равномерном
      // потоке управления. Кромка карлика режущая физически (шкала высот его
      // атмосферы — 3e-5 радиуса), поэтому сглаживание здесь обязано быть ровно
      // в пиксель: любое размытие сверх него рисует атмосферу, которой нет
      float alpha = 1.0 - smoothstep(1.0 - fwidth(r) * 1.5, 1.0, r);
      if (alpha <= 0.0) {
        gl_FragColor = vec4(0.0);
        return;
      }

      // Псевдосфера: mu — косинус к взгляду, точный, а не приближённый
      float mu = sqrt(max(1.0 - r * r, 0.0));

      vec3 color = wdShade(mu, uColorBase, uPlanckX, uCoreIntensity, uProximityExposure);

      gl_FragColor = vec4(color, alpha);
    }
  `
}
