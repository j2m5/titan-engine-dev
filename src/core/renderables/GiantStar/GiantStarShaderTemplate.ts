import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, Vector3 } from 'three'
import { STAR_CORE_INTENSITY } from '@/core/materials/shaders/lib/helpers'

/**
 * Фотосфера звезды-гиганта (ближний LOD). Непрозрачна и пишет глубину: по ней
 * проход туманности режет марш. Мягкий край даёт отдельная оболочка
 * (GiantStarShell), а не альфа этого меша.
 *
 * mu считается в видовом пространстве, домен шума — в объектном: рисунок
 * прибит к телу и вращается вместе с ним.
 */
export const GiantStarShaderTemplate: ShaderProps = {
  uniforms: {
    uColorCool: new Uniform(new Color()),
    uColorBase: new Uniform(new Color()),
    uColorHot: new Uniform(new Color()),
    /** Яркость стопов палитры относительно базового, см. giantStarCellEnergy */
    uCellEnergy: new Uniform(new Vector3(1, 1, 1)),
    /** hc/(lambda*k*Teff) по каналам R/G/B — единственный вход лимба */
    uPlanckX: new Uniform(new Vector3()),
    uCoreIntensity: new Uniform(STAR_CORE_INTENSITY),
    uProximityExposure: new Uniform(1),
    uCellCount: new Uniform(5),
    uSeed: new Uniform(0),
    time: new Uniform(0)
  },
  vertexShader: `
    varying vec3 vViewPosition;
    varying vec3 vViewNormal;
    varying vec3 vObjectPosition;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      // modelViewMatrix собирается на CPU в double: мировой сдвиг тела
      // сокращается с камерой до спуска во float32
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      vViewPosition = mvPosition.xyz;
      vViewNormal = normalize(normalMatrix * normal);
      vObjectPosition = position;

      gl_Position = projectionMatrix * mvPosition;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 uColorCool;
    uniform vec3 uColorBase;
    uniform vec3 uColorHot;
    uniform vec3 uCellEnergy;
    uniform vec3 uPlanckX;
    uniform float uCoreIntensity;
    uniform float uProximityExposure;
    uniform float uCellCount;
    uniform float uSeed;
    uniform float time;

    varying vec3 vViewPosition;
    varying vec3 vViewNormal;
    varying vec3 vObjectPosition;

    #include <noiseFunctions>
    #include <starSurface>
    #include <planckLimb>
    #include <giantStarSurface>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      // Единичное направление, а не абсолютная позиция: размер ячейки задан в
      // долях радиуса, и облик не зависит от масштаба звезды
      vec3 domain = normalize(vObjectPosition) * uCellCount + uSeed;
      float domainPerPixel = starDomainPerPixel(domain);

      float mu = clamp(dot(normalize(vViewNormal), normalize(-vViewPosition)), 0.0, 1.0);

      vec3 color = giantStarShade(
        domain, domainPerPixel, time, mu,
        uColorCool, uColorBase, uColorHot, uCellEnergy,
        uPlanckX, uCoreIntensity, uProximityExposure
      );

      gl_FragColor = vec4(color, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
