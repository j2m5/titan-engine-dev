import { BufferAttribute, BufferGeometry, CubeTexture, GLSL3, Mesh, RawShaderMaterial, Uniform } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { createSkyUniforms } from '@/core/materials/shaders/lib/chunks/SkySample'

/**
 * Собственный проход фона вместо `scene.background`: небо читается общим
 * чанком (SkySample) — тем же, что у лензированного фона чёрной дыры, иначе на
 * кромке сферы линзы ступенька. Внутренний фоновый шейдер three через
 * `onBeforeCompile` не проходит, патчить его нельзя.
 *
 * Полноэкранный треугольник, а не куб: не нужно ни следить за камерой, ни
 * подбирать размер под `far`, ни думать о логарифмической глубине.
 *
 * Геометрия и материал — обычные поля `Mesh`, поэтому обход дерева сцены при
 * разборке сценария (`disposeSceneTree`) освобождает их сам; отдельного
 * `dispose()` здесь не нужно. Кубмапу (режим cubemap) передают снаружи и не
 * освобождают — она принадлежит `resourceStorage`; в режиме gaia — null, небом
 * владеет GaiaSky.
 */
class SkyboxBackground extends Mesh {
  public constructor(texture: CubeTexture | null) {
    // Треугольник, накрывающий клип-пространство: две вершины уходят за
    // пределы экрана, растр отсекает лишнее сам
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))

    const material = new RawShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        skybox: new Uniform(texture),
        // Юниформы неба: в режиме gaia — общие экземпляры GaiaSky; в режиме
        // cubemap — ручки кубмапы с флипом X (см. `createSkyboxSampleUniforms`)
        ...createSkyUniforms()
      },
      // Вершинник без #include, но прогоняется через prepareSource тем же
      // способом, что и фрагментник: собирается напрямую, минуя конструктор
      // AbstractShader, и застраховаться от будущего немого include дешевле,
      // чем полагаться на то, что он не понадобится
      vertexShader: AbstractShader.prepareSource(/* glsl */ `
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
      `),
      fragmentShader: AbstractShader.prepareSource(/* glsl */ `
        precision highp float;

        uniform samplerCube skybox;

        #include <skySampleUniforms>
        #include <skySampleFunctions>

        in vec3 vRay;

        layout(location = 0) out vec4 fragColor;

        void main() {
          // Производные — до любых ветвлений: по ним фильтр звёзд берёт отпечаток пикселя
          vec3 dir = normalize(vRay);
          fragColor = vec4(sampleSky(dir, dFdx(dir), dFdy(dir)), 1.0);
        }
      `),

      depthTest: false,
      depthWrite: false
    })

    super(geometry, material)

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
