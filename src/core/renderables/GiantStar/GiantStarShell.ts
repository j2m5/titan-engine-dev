import {
  AlwaysDepth,
  BackSide,
  BufferGeometry,
  Camera,
  FrontSide,
  LessEqualDepth,
  Matrix4,
  Mesh,
  NormalBlending,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  UniformsUtils,
  Vector3,
  type WebGLRenderer
} from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { GiantStar } from '@/core/renderables/GiantStar/GiantStar'
import { GiantStarShellShaderTemplate } from '@/core/renderables/GiantStar/GiantStarShellShaderTemplate'
import { shellDensityScale } from '@/core/renderables/GiantStar/shellMath'

/** Объекты Uniform тела, разделяемые целиком: снапшот скаляра разъехался бы молча */
const SHELL_SHARED_UNIFORMS: readonly string[] = [
  'uColorCool',
  'uCellEnergy',
  'uCoreIntensity',
  'uProximityExposure',
  'uSeed',
  'time'
]

/**
 * Оболочка-атмосфера: прокси-сфера, описанная вокруг всей протяжённости.
 * Вешается ДОЧЕРНИМ мешем тела — переключается LOD'ом вместе с ним и делит его
 * matrixWorld.
 *
 * Глубину не пишет: фотосфера под ней остаётся единственным, по чему проход
 * туманности режет марш.
 */
class GiantStarShell extends Mesh {
  declare public geometry: BufferGeometry
  declare public material: ShaderMaterial

  private readonly outerRadius: number
  private readonly cameraWorld: Vector3 = new Vector3()
  private readonly inverseModel: Matrix4 = new Matrix4()

  public constructor(body: GiantStar) {
    super()

    const height: number = body.parameters.atmosphereHeight

    this.outerRadius = body.radius * (1 + height)
    this.geometry = new SphereGeometry(this.outerRadius, 128, 128)

    this.material = new ShaderMaterial({
      vertexShader: AbstractShader.prepareSource(GiantStarShellShaderTemplate.vertexShader),
      fragmentShader: AbstractShader.prepareSource(GiantStarShellShaderTemplate.fragmentShader),
      uniforms: UniformsUtils.clone(GiantStarShellShaderTemplate.uniforms),
      transparent: true,
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
      side: FrontSide,
      blending: NormalBlending
    })

    for (const key of SHELL_SHARED_UNIFORMS) {
      this.material.uniforms[key] = body.material.uniforms[key]
    }

    this.material.uniforms.uInvRadius.value = body.radius > 0 ? 1 / body.radius : 0
    this.material.uniforms.uAtmosphereHeight.value = height
    this.material.uniforms.uDensityScale.value = shellDensityScale(height, body.parameters.atmosphereDensity)

    this.name = body.name + 'Shell'
    // Погашенная оболочка не должна стоить ни одного фрагмента
    this.visible = body.parameters.atmosphereDensity > 0

    const invRadius: number = this.material.uniforms.uInvRadius.value

    this.onBeforeRender = (_renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
      camera.getWorldPosition(this.cameraWorld)
      this.cameraWorld.applyMatrix4(this.inverseModel.copy(this.matrixWorld).invert())

      // Внутри оболочки лицевые грани отсечены — рисуем изнанку. Тест глубины
      // там снят: обрезку фотосферой делает интеграл, а чужое тело в зазоре
      // между камерой и фотосферой оказаться не может
      const inside: boolean = this.cameraWorld.length() < this.outerRadius

      this.material.side = inside ? BackSide : FrontSide
      this.material.depthFunc = inside ? AlwaysDepth : LessEqualDepth

      this.material.uniforms.uCameraUnit.value.copy(this.cameraWorld).multiplyScalar(invRadius)
    }
  }

  public dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export { GiantStarShell, SHELL_SHARED_UNIFORMS }
