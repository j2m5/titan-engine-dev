import {
  BufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  UniformsUtils,
  Vector3,
  type WebGLRenderer
} from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { frameHeightAt, WHITE_DWARF_IMPOSTOR_PIXELS } from '@/core/helpers/apparentSize'
import { UpdateContext } from '@/core/UpdateContext'
import { WhiteDwarf } from '@/core/renderables/WhiteDwarf/WhiteDwarf'
import { WhiteDwarfImpostorShaderTemplate } from '@/core/renderables/WhiteDwarf/WhiteDwarfImpostorShaderTemplate'

/** Юниформы, копируемые с тела: единый источник цвета, лимба и яркости */
const SHARED_UNIFORMS: readonly string[] = ['uColorBase', 'uPlanckX', 'uCoreIntensity', 'uProximityExposure']

/**
 * Билборд-импостор карлика: дальний уровень LOD, и на практике — то, чем
 * карлик виден почти всегда. С 1 а.е. его угловой размер около 17 угловых
 * секунд против 1919 у Солнца, а порога в 12 пикселей диск достигает лишь
 * примерно с 1.3 млн км.
 *
 * uBodyRotation, в отличие от коричневого карлика, здесь нет: поворачивать
 * нечего, поверхность однородна. По той же причине нет и uTime.
 *
 * Размер меряется под WHITE_DWARF_IMPOSTOR_PIXELS — той же константой, по
 * которой ApparentSizeLod выбирает дистанцию переключения.
 */
class WhiteDwarfImpostor extends Mesh {
  declare public geometry: BufferGeometry
  declare public material: ShaderMaterial

  private readonly worldPosition: Vector3 = new Vector3()
  private readonly cameraPosition: Vector3 = new Vector3()

  public constructor(
    private readonly body: WhiteDwarf,
    private readonly renderer: WebGLRenderer
  ) {
    super()

    this.geometry = new PlaneGeometry(1, 1)

    // NormalBlending и depthWrite: false — как у импостора звезды: квад
    // перекрывает фон непрозрачным диском, но не режет объекты позади.
    // prepareSource обязателен: без него `#include <whiteDwarfSurface>` уедет
    // в компилятор как есть, и шейдер не соберётся
    this.material = new ShaderMaterial({
      vertexShader: AbstractShader.prepareSource(WhiteDwarfImpostorShaderTemplate.vertexShader),
      fragmentShader: AbstractShader.prepareSource(WhiteDwarfImpostorShaderTemplate.fragmentShader),
      uniforms: UniformsUtils.clone(WhiteDwarfImpostorShaderTemplate.uniforms),
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: NormalBlending
    })

    for (const key of SHARED_UNIFORMS) {
      this.material.uniforms[key].value = this.body.material.uniforms[key].value
    }
  }

  public updateObject(ctx: UpdateContext): void {
    const cameraPosition: Vector3 = ctx.camera.getWorldPosition(this.cameraPosition)

    this.lookAt(cameraPosition)

    // Позиция мировая, а не локальная: билборд висит в нуле родительского узла.
    // Ту же величину меряет LOD.update, выбирая между диском и билбордом
    const distance: number = this.getWorldPosition(this.worldPosition).distanceTo(cameraPosition)
    const viewportHeight: number = this.renderer.domElement.height
    const worldSize: number = (WHITE_DWARF_IMPOSTOR_PIXELS / viewportHeight) * frameHeightAt(distance, ctx.camera.fov)

    this.scale.setScalar(worldSize)
  }

  public dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export { WhiteDwarfImpostor, SHARED_UNIFORMS }
