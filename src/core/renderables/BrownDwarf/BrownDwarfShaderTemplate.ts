import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, Vector3 } from 'three'

export const BrownDwarfShaderTemplate: ShaderProps = {
  uniforms: {
    uCameraObject: new Uniform(new Vector3()),
    uColorCloud: new Uniform(new Color()),
    uColorHot: new Uniform(new Color()),
    uOpticalDepth: new Uniform(3),
    uGapGlow: new Uniform(3),
    uGapThreshold: new Uniform(0.42),
    uParallax: new Uniform(0.02),
    uBreathAmplitude: new Uniform(0.08),
    uSeed: new Uniform(4096),
    uBandCount: new Uniform(4.5),
    uTurbulence: new Uniform(1.6),
    uBandWarp: new Uniform(0.16),
    uZonalShear: new Uniform(0.5),
    uFineDetail: new Uniform(0.25),
    uPolarChaos: new Uniform(0.8),
    uVortexStrength: new Uniform(0.35),
    time: new Uniform(0)
  },
  vertexShader: `
    varying vec3 vPosition;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

      vPosition = position;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    /**
     * Позиция камеры в ОБЪЕКТНЫХ координатах тела.
     *
     * Весь фрагментный шейдер живёт в одной системе координат, и это
     * структурная защита, а не удобство: смешать мировой вектор с объектным
     * здесь физически нечем, потому что мировых векторов нет. Смешение дало бы
     * сдвиг выборки, зависящий от поворота тела, — то есть рисунок поехал бы
     * при вращении, ровно тот класс дефекта, от которого уходит вся арка.
     *
     * Перевод делает CPU в updateObject: modelMatrix во фрагментном шейдере
     * three недоступна (в префикс попадают только viewMatrix, cameraPosition
     * и isOrthographic), а GLSL ES 1.00 не умеет inverse().
     */
    uniform vec3 uCameraObject;

    uniform vec3 uColorCloud;
    uniform vec3 uColorHot;
    uniform float uOpticalDepth;
    uniform float uGapGlow;
    uniform float uGapThreshold;
    uniform float uParallax;
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

    varying vec3 vPosition;

    #include <noiseFunctions>
    #include <starSurface>
    #include <brownDwarfSurface>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      // Домен прибит к телу: рисунок вращается вместе с карликом и не
      // пересеивается при вращении — координата объектная, не мировая
      vec3 dir = normalize(vPosition);
      vec3 viewO = normalize(uCameraObject - vPosition);

      // Поворот сохраняет скалярное произведение, поэтому mu в объектных
      // координатах тот же, что был бы в мировых
      float mu = clamp(dot(dir, viewO), 0.0, 1.0);

      // Параллакс: верхушки облаков смещаются относительно провалов при
      // движении камеры. Высота берётся дешёвым bdHeight (домен не
      // коробленный) — на сдвиге в пару текселей разница с точной высотой
      // из bdField неразличима, а полный вызов стоил бы восемнадцати
      // лишних октав ради одного канала
      float height = bdHeight(dir, uSeed);

      // В центре диска взгляд совпадает с нормалью, касательная вырождается
      // в ноль и normalize дал бы NaN. Параллакса там и нет — сдвигать нечего
      vec3 tangent = viewO - dir * dot(viewO, dir);
      vec3 shifted = dot(tangent, tangent) < 1e-8
        ? dir
        : normalize(dir - normalize(tangent) * (height * uParallax));

      vec2 field = bdField(shifted, uSeed, uBandCount, uTurbulence, uGapThreshold, uBandWarp, uZonalShear, uFineDetail, uPolarChaos, uVortexStrength);

      // Вся композиция — одной точкой входа чанка. Импостор зовёт ту же
      // функцию теми же аргументами: разойтись двум LOD нечем
      vec3 color = bdShade(field, mu, dir, uColorCloud, uColorHot,
                           uOpticalDepth, uGapGlow, time, uBreathAmplitude);

      gl_FragColor = vec4(color, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
