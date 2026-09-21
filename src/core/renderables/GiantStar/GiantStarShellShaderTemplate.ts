import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, Vector3 } from 'three'
import { STAR_CORE_INTENSITY } from '@/core/materials/shaders/lib/helpers'

/**
 * Оболочка-атмосфера гиганта. Луч строится в ОБЪЕКТНЫХ координатах в единицах
 * радиуса: камеру переводит CPU (uCameraUnit), мировых координат в шейдере нет.
 *
 * tonemapping_fragment/colorspace_fragment отсутствуют намеренно: рендер идёт в
 * линейный таргет композера, тонмапом владеет пост-пайплайн (прецедент —
 * WhiteDwarfImpostorShaderTemplate).
 */
export const GiantStarShellShaderTemplate: ShaderProps = {
  uniforms: {
    uColorCool: new Uniform(new Color()),
    uCellEnergy: new Uniform(new Vector3(1, 1, 1)),
    uCoreIntensity: new Uniform(STAR_CORE_INTENSITY),
    uProximityExposure: new Uniform(1),
    uSeed: new Uniform(0),
    time: new Uniform(0),
    /** Камера в объектных координатах тела, в единицах радиуса фотосферы */
    uCameraUnit: new Uniform(new Vector3()),
    /** 1 / радиус фотосферы в юнитах сцены */
    uInvRadius: new Uniform(1),
    uAtmosphereHeight: new Uniform(0.3),
    uDensityScale: new Uniform(0)
  },
  vertexShader: `
    varying vec3 vUnitPosition;

    uniform float uInvRadius;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      vUnitPosition = position * uInvRadius;

      gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 uColorCool;
    uniform vec3 uCellEnergy;
    uniform float uCoreIntensity;
    uniform float uProximityExposure;
    uniform float uSeed;
    uniform float time;
    uniform vec3 uCameraUnit;
    uniform float uAtmosphereHeight;
    uniform float uDensityScale;

    varying vec3 vUnitPosition;

    #include <noiseFunctions>
    #include <starSurface>
    #include <giantStarShell>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      vec3 dir = normalize(vUnitPosition - uCameraUnit);

      vec3 woolDomain = gsShellClosestDir(uCameraUnit, dir) * GS_SHELL_WOOL_FREQUENCY + uSeed;
      float wool = gsShellWool(woolDomain, time, starGranulationFade(starDomainPerPixel(woolDomain)));

      gl_FragColor = giantStarShell(
        uCameraUnit, dir, uAtmosphereHeight, uDensityScale, wool,
        uColorCool, uCellEnergy.x, uCoreIntensity, uProximityExposure
      );
    }
  `
}
