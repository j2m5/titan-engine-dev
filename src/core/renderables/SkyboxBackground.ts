import { BufferAttribute, BufferGeometry, CubeTexture, GLSL3, Mesh, RawShaderMaterial, Uniform } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { config } from '@/core/framework/config'

/**
 * Собственный проход фона вместо `scene.background`.
 *
 * Забран у three ради единственной вещи: расширение хайлайтов обязано
 * применяться и к прямому фону, и к линзированному фону чёрной дыры одной и
 * той же функцией. Внутренний фоновый шейдер three не проходит через
 * `onBeforeCompile`, поэтому патчить его нельзя.
 *
 * Полноэкранный треугольник, а не куб: не нужно ни следить за камерой, ни
 * подбирать размер под `far`, ни думать о логарифмической глубине.
 *
 * Геометрия и материал — обычные поля `Mesh`, поэтому обход дерева сцены при
 * разборке сценария (`disposeSceneTree`) освобождает их сам; отдельного
 * `dispose()` здесь не нужно. Текстуру в конструктор передают снаружи и не
 * освобождают — она принадлежит `resourceStorage`.
 */
class SkyboxBackground extends Mesh {
  public constructor(texture: CubeTexture) {
    super()

    // Треугольник, накрывающий клип-пространство: две вершины уходят за
    // пределы экрана, растр отсекает лишнее сам
    this.geometry = new BufferGeometry()
    this.geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
    )

    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        skybox: new Uniform(texture),
        // Ориентация прямого фона. Подобрана против кадра «до» (Task 2, Step 5):
        // three рисует фоновую кубмапу «изнутри», с инверсией X, а свой проход
        // этой инверсии не наследует — без компенсации Млечный Путь выходит
        // зеркальным (проверено сравнением кадров «до»/«после» по положению
        // пылевой прожилки относительно маркера Земли). У линзированного пути
        // ЧД своя ручка envMapFlipX — значения не обязаны совпадать.
        uFlipX: new Uniform(-1),
        uSkyHighlightThreshold: new Uniform(config('background.highlightThreshold')),
        uSkyHighlightBoost: new Uniform(config('background.highlightBoost'))
      },
      vertexShader: /* glsl */ `
        precision highp float;

        uniform mat4 projectionMatrix;
        uniform mat4 viewMatrix;

        in vec3 position;

        out vec3 vRay;

        void main() {
          vec4 clip = vec4(position.xy, 1.0, 1.0);

          // Луч из клип-пространства обратно в мировое. inverse() здесь дёшев:
          // вершин ровно три, а не миллион
          vec4 eye = inverse(projectionMatrix) * clip;
          vRay = (inverse(viewMatrix) * vec4(eye.xy, -1.0, 0.0)).xyz;

          gl_Position = clip;
        }
      `,
      fragmentShader: AbstractShader.prepareSource(/* glsl */ `
        precision highp float;

        uniform samplerCube skybox;
        uniform float uFlipX;

        #include <skyboxSampleUniforms>
        #include <skyboxSampleFunctions>

        in vec3 vRay;

        layout(location = 0) out vec4 fragColor;

        void main() {
          fragColor = vec4(sampleSkyboxHdr(skybox, normalize(vRay), uFlipX), 1.0);
        }
      `),

      depthTest: false,
      depthWrite: false
    })

    // Вырожденный bounding-объём треугольника иначе периодически отсекается
    // фрустумом, и фон мигает
    this.frustumCulled = false
    // depthTest выключен: фон, попавший в очередь после непрозрачной геометрии,
    // затрёт её — поэтому он обязан рисоваться первым
    this.renderOrder = -1000

    this.name = 'SkyboxBackground'
  }
}

export { SkyboxBackground }
