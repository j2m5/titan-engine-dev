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
import { BROWN_DWARF_IMPOSTOR_PIXELS, frameHeightAt } from '@/core/helpers/apparentSize'
import { UpdateContext } from '@/core/UpdateContext'
import { BrownDwarf } from '@/core/renderables/BrownDwarf/BrownDwarf'
import { BrownDwarfImpostorShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfImpostorShaderTemplate'

/**
 * Билборд-импостор карлика: дальний уровень LOD.
 *
 * Поверхность считается теми же функциями чанка brownDwarfSurface по ТОЙ ЖЕ
 * кубмапе, что и диск, а палитра и ручки копируются из материала тела —
 * на дистанции переключения уровни совпадают по построению, ручек подстройки
 * нет намеренно (тот же контракт, что у FakeStar).
 *
 * Размер меряется под BROWN_DWARF_IMPOSTOR_PIXELS.
 */
class BrownDwarfImpostor extends Mesh {
  declare public geometry: BufferGeometry
  declare public material: ShaderMaterial

  private readonly worldPosition: Vector3 = new Vector3()
  private readonly cameraPosition: Vector3 = new Vector3()
  private readonly bodyRotation: Matrix4 = new Matrix4()
  private readonly viewRotation: Matrix4 = new Matrix4()

  public constructor(
    private readonly body: BrownDwarf,
    private readonly renderer: WebGLRenderer
  ) {
    super()

    this.geometry = new PlaneGeometry(1, 1)

    // NormalBlending и depthWrite: false — как у импостора звезды: квад
    // перекрывает фон непрозрачным диском, но не режет объекты позади
    this.material = new ShaderMaterial({
      vertexShader: AbstractShader.prepareSource(BrownDwarfImpostorShaderTemplate.vertexShader),
      fragmentShader: AbstractShader.prepareSource(BrownDwarfImpostorShaderTemplate.fragmentShader),
      uniforms: UniformsUtils.clone(BrownDwarfImpostorShaderTemplate.uniforms),
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: NormalBlending
    })

    // Юниформы копируются из тела: единый источник палитры и ручек
    for (const key of ['uClouds', 'uColorCloud', 'uColorHot', 'uOpticalDepth', 'uGapGlow', 'uBreathAmplitude']) {
      this.material.uniforms[key].value = this.body.material.uniforms[key].value
    }
  }

  public updateObject(ctx: UpdateContext): void {
    const cameraPosition: Vector3 = ctx.camera.getWorldPosition(this.cameraPosition)

    this.lookAt(cameraPosition)

    this.material.uniforms.time.value = ctx.elapsed

    // Нормаль псевдосферы живёт в системе камеры; чтобы рисунок остался
    // прибитым к телу, её надо перевести в систему тела:
    // body^-1 * view. Матрица тела берётся живой, а не замороженной при
    // создании: карлик вращается.
    this.viewRotation.extractRotation(ctx.camera.matrixWorld)
    this.bodyRotation.extractRotation(this.body.matrixWorld).invert()
    this.material.uniforms.uBodyRotation.value.setFromMatrix4(this.bodyRotation.multiply(this.viewRotation))

    // Позиция мировая, а не локальная: билборд висит в нуле родительского узла.
    // Ту же величину меряет LOD.update, выбирая между диском и билбордом
    const distance: number = this.getWorldPosition(this.worldPosition).distanceTo(cameraPosition)
    const viewportHeight: number = this.renderer.domElement.height
    const worldSize: number = (BROWN_DWARF_IMPOSTOR_PIXELS / viewportHeight) * frameHeightAt(distance, ctx.camera.fov)

    this.scale.setScalar(worldSize)
  }
}

export { BrownDwarfImpostor }
