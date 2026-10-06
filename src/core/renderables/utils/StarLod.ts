import { Uniform, Vector3, WebGLRenderer } from 'three'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { STAR_IMPOSTOR_PIXELS } from '@/core/helpers/apparentSize'
import { StarFarGlow, starFarGlowGain } from '@/core/renderables/utils/starFarGlow'
import { config } from '@/core/framework/config'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * LOD звезды: ApparentSizeLod с зашитым размером импостора.
 *
 * Отдельный класс, а не прямой вызов ApparentSizeLod на стороне фабрики:
 * STAR_IMPOSTOR_PIXELS — не параметр вызова, а часть контракта звезды, по
 * которому сведён стык LOD, и вызывающей стороне нечем его подменить. Тот же
 * приём, что у starLodSwitchDistance.
 *
 * glowGain — усиление свечения издалека (starFarGlowGain). Объект Uniform
 * общий у диска и билборда: оба уровня читают одно число, и стык по яркости
 * сведён при любом усилении.
 */
class StarLod extends ApparentSizeLod {
  public readonly glowGain: Uniform<number> = new Uniform(1)

  private readonly worldPosition: Vector3 = new Vector3()
  private readonly cameraPosition: Vector3 = new Vector3()

  public constructor(
    radiusKm: number,
    renderer: WebGLRenderer,
    private readonly farGlow: StarFarGlow = {
      gain: config('star.farGlowGain'),
      fadePixels: config('star.farGlowFadePixels')
    }
  ) {
    super(radiusKm, renderer, STAR_IMPOSTOR_PIXELS)
  }

  public updateObject(ctx: UpdateContext): void {
    super.updateObject(ctx)

    // Мировая позиция: LOD висит в нуле DynamicNode, как и билборд
    const distance: number = this.getWorldPosition(this.worldPosition).distanceTo(
      ctx.camera.getWorldPosition(this.cameraPosition)
    )
    // Видимый размер обратно пропорционален дистанции: на переключении ровно 12 px
    const pixels: number = (STAR_IMPOSTOR_PIXELS * this.switchDistance(ctx.camera.fov)) / distance

    this.glowGain.value = starFarGlowGain(pixels, this.farGlow.gain, this.farGlow.fadePixels)
  }
}

export { StarLod }
