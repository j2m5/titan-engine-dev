import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, Matrix3, ShaderChunk, Uniform, Vector3 } from 'three'
import { STAR_CORE_INTENSITY } from '@/core/materials/shaders/lib/helpers'

/**
 * Билборд-импостор гиганта: ядро и оболочка в одном кваде. Зовёт те же
 * giantStarShade и giantStarShell, что диск и меш оболочки.
 *
 * Луч параллельный: на дистанции переключения перспектива неотличима от
 * ортографии. Квад крупнее ядра в uQuadScale раз — на протяжённость оболочки.
 *
 * Своего множителя яркости нет НАМЕРЕННО.
 *
 * tonemapping_fragment/colorspace_fragment отсутствуют намеренно: рендер идёт в
 * линейный таргет композера, тонмапом владеет пост-пайплайн (прецедент —
 * WhiteDwarfImpostorShaderTemplate).
 */
export const GiantStarImpostorShaderTemplate: ShaderProps = {
  uniforms: {
    uColorCool: new Uniform(new Color()),
    uColorBase: new Uniform(new Color()),
    uColorHot: new Uniform(new Color()),
    uCellEnergy: new Uniform(new Vector3(1, 1, 1)),
    uPlanckX: new Uniform(new Vector3()),
    uCoreIntensity: new Uniform(STAR_CORE_INTENSITY),
    uProximityExposure: new Uniform(1),
    uCellCount: new Uniform(5),
    uSeed: new Uniform(0),
    time: new Uniform(0),
    uAtmosphereHeight: new Uniform(0.3),
    uDensityScale: new Uniform(0),
    /** Система билборда -> объектная система тела */
    uBodyRotation: new Uniform(new Matrix3()),
    /** 1 + atmosphereHeight: радиус квада в единицах радиуса фотосферы */
    uQuadScale: new Uniform(1.3)
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
    uniform vec3 uCellEnergy;
    uniform vec3 uPlanckX;
    uniform float uCoreIntensity;
    uniform float uProximityExposure;
    uniform float uCellCount;
    uniform float uSeed;
    uniform float time;
    uniform float uAtmosphereHeight;
    uniform float uDensityScale;
    uniform mat3 uBodyRotation;
    uniform float uQuadScale;

    varying vec2 vUv;

    #include <noiseFunctions>
    #include <starSurface>
    #include <planckLimb>
    #include <giantStarSurface>
    #include <giantStarShell>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      // Координаты квада в единицах радиуса фотосферы
      vec2 c = (vUv * 2.0 - 1.0) * uQuadScale;
      float r = length(c);

      // Всё, что берёт производные, — до ветвления. Вне ядра нормаль
      // псевдосферы зажата на его кромку: значение там не используется, но
      // производная обязана существовать
      float rCore = min(r, 1.0);
      vec3 normalBillboard = vec3(c * (rCore / max(r, 1e-6)), sqrt(max(1.0 - rCore * rCore, 0.0)));
      vec3 domain = (uBodyRotation * normalBillboard) * uCellCount + uSeed;
      float domainPerPixel = starDomainPerPixel(domain);
      float edge = fwidth(r);

      // Параллельный луч вдоль -Z билборда, переведённый в систему тела
      vec3 origin = uBodyRotation * vec3(c, uQuadScale + 1.0);
      vec3 dir = uBodyRotation * vec3(0.0, 0.0, -1.0);

      vec3 woolDomain = gsShellClosestDir(origin, dir) * GS_SHELL_WOOL_FREQUENCY + uSeed;
      float wool = gsShellWool(woolDomain, time, starGranulationFade(starDomainPerPixel(woolDomain)));

      vec4 shell = giantStarShell(
        origin, dir, uAtmosphereHeight, uDensityScale, wool,
        uColorCool, uCellEnergy.x, uCoreIntensity, uProximityExposure
      );

      vec4 result = shell;

      if (r < 1.0) {
        vec3 core = giantStarShade(
          domain, domainPerPixel, time, normalBillboard.z,
          uColorCool, uColorBase, uColorHot, uCellEnergy,
          uPlanckX, uCoreIntensity, uProximityExposure
        );
        // 1.5 — ширина сглаживания кромки в пикселях; нижняя граница нужна,
        // чтобы кромки smoothstep не совпали при edge = 0 (неопределённость)
        float aa = max(edge * 1.5, 1e-4);
        float coreAlpha = 1.0 - smoothstep(1.0 - aa, 1.0, r);

        // Ядро под оболочкой: тот же порядок, что даёт блендинг двух мешей
        result = vec4(
          shell.rgb + core * coreAlpha * (1.0 - shell.a),
          shell.a + coreAlpha * (1.0 - shell.a)
        );
      }

      gl_FragColor = result;
    }
  `
}
