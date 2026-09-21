import {
  BufferGeometry,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  UniformsUtils,
  Vector3,
  type WebGLRenderer
} from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { frameHeightAt, GIANT_STAR_IMPOSTOR_PIXELS } from '@/core/helpers/apparentSize'
import { UpdateContext } from '@/core/UpdateContext'
import { GiantStar } from '@/core/renderables/GiantStar/GiantStar'
import { GiantStarShell } from '@/core/renderables/GiantStar/GiantStarShell'
import { GiantStarImpostorShaderTemplate } from '@/core/renderables/GiantStar/GiantStarImpostorShaderTemplate'

/** Объекты Uniform, разделяемые с телом целиком */
const IMPOSTOR_SHARED_BODY_UNIFORMS: readonly string[] = [
  'uColorCool',
  'uColorBase',
  'uColorHot',
  'uCellEnergy',
  'uPlanckX',
  'uCoreIntensity',
  'uProximityExposure',
  'uCellCount',
  'uSeed',
  'time'
]

/** Объекты Uniform, разделяемые с оболочкой */
const IMPOSTOR_SHARED_SHELL_UNIFORMS: readonly string[] = ['uAtmosphereHeight', 'uDensityScale']

/**
 * Билборд-импостор гиганта: дальний уровень LOD. Размер ядра меряется под
 * GIANT_STAR_IMPOSTOR_PIXELS — той же константой, по которой ApparentSizeLod
 * выбирает дистанцию переключения; квад крупнее на протяжённость оболочки.
 *
 * time тело пишет само: SceneManager.update обходит сцену через scene.traverse,
 * который заходит во ВСЕ узлы независимо от видимости LOD-уровня, поэтому
 * тело обновляется каждый кадр и здесь дублировать этот вызов не нужно.
 */
class GiantStarImpostor extends Mesh {
  declare public geometry: BufferGeometry
  declare public material: ShaderMaterial

  private readonly worldPosition: Vector3 = new Vector3()
  private readonly cameraPosition: Vector3 = new Vector3()
  private readonly bodyRotation: Matrix4 = new Matrix4()
  private readonly billboardRotation: Matrix4 = new Matrix4()
  private readonly quadScale: number

  public constructor(
    private readonly body: GiantStar,
    shell: GiantStarShell,
    private readonly renderer: WebGLRenderer
  ) {
    super()

    this.geometry = new PlaneGeometry(1, 1)
    this.quadScale = 1 + body.parameters.atmosphereHeight

    this.material = new ShaderMaterial({
      vertexShader: AbstractShader.prepareSource(GiantStarImpostorShaderTemplate.vertexShader),
      fragmentShader: AbstractShader.prepareSource(GiantStarImpostorShaderTemplate.fragmentShader),
      uniforms: UniformsUtils.clone(GiantStarImpostorShaderTemplate.uniforms),
      transparent: true,
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
      blending: NormalBlending
    })

    for (const key of IMPOSTOR_SHARED_BODY_UNIFORMS) {
      this.material.uniforms[key] = body.material.uniforms[key]
    }
    for (const key of IMPOSTOR_SHARED_SHELL_UNIFORMS) {
      this.material.uniforms[key] = shell.material.uniforms[key]
    }

    this.material.uniforms.uQuadScale.value = this.quadScale

    // Нормаль псевдосферы живёт в системе БИЛБОРДА, а не камеры: матрица
    // камеры крутила бы узор при панорамировании. Считается в onBeforeRender —
    // lookAt из updateObject попадает в matrixWorld уже внутри рендера
    this.onBeforeRender = (): void => {
      this.bodyRotation.extractRotation(this.body.matrixWorld).invert()
      this.billboardRotation.extractRotation(this.matrixWorld)

      this.material.uniforms.uBodyRotation.value.setFromMatrix4(this.bodyRotation.multiply(this.billboardRotation))
    }
  }

  public updateObject(ctx: UpdateContext): void {
    const cameraPosition: Vector3 = ctx.camera.getWorldPosition(this.cameraPosition)

    this.lookAt(cameraPosition)

    // Позиция мировая: билборд висит в нуле родительского узла
    const distance: number = this.getWorldPosition(this.worldPosition).distanceTo(cameraPosition)
    const viewportHeight: number = this.renderer.domElement.height
    const worldSize: number =
      ((GIANT_STAR_IMPOSTOR_PIXELS * this.quadScale) / viewportHeight) * frameHeightAt(distance, ctx.camera.fov)

    this.scale.setScalar(worldSize)
  }

  public dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export { GiantStarImpostor, IMPOSTOR_SHARED_BODY_UNIFORMS, IMPOSTOR_SHARED_SHELL_UNIFORMS }
