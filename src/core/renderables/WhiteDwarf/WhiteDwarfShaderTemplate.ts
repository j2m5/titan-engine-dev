import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, Vector3 } from 'three'
import { STAR_CORE_INTENSITY } from '@/core/materials/shaders/lib/helpers'

/**
 * Диск белого карлика (ближний LOD).
 *
 * Юниформов три, и это не заготовка под расширение: поверхность безлика по
 * физике, а цвет, яркость и лимбовое потемнение выводятся из одной величины —
 * температуры. Всё остальное, что есть у звезды (грануляция, шум, время,
 * протуберанцы), здесь отсутствовало бы даже при бесконечном бюджете.
 */
export const WhiteDwarfShaderTemplate: ShaderProps = {
  uniforms: {
    uColorBase: new Uniform(new Color()),
    /** hc/(lambda*k*Teff) по каналам R/G/B — единственный вход лимба, см. planckX */
    uPlanckX: new Uniform(new Vector3()),
    uCoreIntensity: new Uniform(STAR_CORE_INTENSITY),
    uProximityExposure: new Uniform(1)
  },
  vertexShader: `
    varying vec3 vViewPosition;
    varying vec3 vViewNormal;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      // modelViewMatrix, а НЕ modelMatrix с последующим умножением на viewMatrix.
      //
      // Это несущее различие, а не стилистика. modelViewMatrix три считает на
      // CPU в double, и абсолютный мировой сдвиг тела сокращается с позицией
      // камеры ДО спуска во float32. Перемножь их в шейдере — и вершины
      // квантуются шагом ULP мировой позиции: у Sirius B, который стоит в
      // 994 000 юнитов от барицентра при собственном радиусе 2.93, это даёт
      // около 49 ступеней на радиус, то есть видимую гранёность шара.
      //
      // Тело в начале координат (WD 2226-210) дефект не показывает вовсе —
      // ему нечего терять, сдвиг нулевой. Отсюда и асимметрия при отладке.
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      vViewPosition = mvPosition.xyz;
      // normalMatrix — обратно-транспонированная modelView, тоже с CPU
      vViewNormal = normalize(normalMatrix * normal);

      gl_Position = projectionMatrix * mvPosition;
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

    varying vec3 vViewPosition;
    varying vec3 vViewNormal;

    #include <whiteDwarfSurface>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      // Видовое пространство: камера в начале координат, поэтому направление на
      // неё — просто -vViewPosition. Мировых координат во фрагменте нет вовсе,
      // и это осознанное расхождение с коричневым карликом: там объектная
      // дисциплина держит домен шума прибитым к телу, здесь рисунка нет и
      // держать нечего, а видовое пространство вдобавок не теряет точность на
      // телах, далеко отстоящих от начала координат.
      float mu = clamp(dot(normalize(vViewNormal), normalize(-vViewPosition)), 0.0, 1.0);

      // Вся композиция — одной точкой входа чанка. Импостор зовёт ту же функцию
      // тем же списком аргументов: разойтись двум LOD нечем
      vec3 color = wdShade(mu, uColorBase, uPlanckX, uCoreIntensity, uProximityExposure);

      gl_FragColor = vec4(color, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
