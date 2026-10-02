import { AdditiveBlending, Color, Sprite, SpriteMaterial, Texture, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { config } from '@/core/framework/config'
import { IMPOSTOR_MAX_CHANNEL, impostorColorFromActor, impostorPhaseAngle, regolithPhase } from '@/core/renderables/utils/planetImpostorMath'
import { regolithParamsOf, type RegolithParams } from '@/core/terrain/regolithParams'
import type { UpdateContext } from '@/core/UpdateContext'

/**
 * Точка планеты дальше порога LOD: цвет тела из Actor.color и фаза по углу
 * звезда–тело–камера (звезда в нуле сцены). В полной фазе яркость прежняя.
 * Фаза — ламберт; у безатмосферных тел — фаза реголита со всплеском.
 */
class FakePlanet extends Sprite {
  public model: Actor
  declare public material: SpriteMaterial

  /** Линейный цвет полной фазы — считается один раз: актор не меняет цвет в рантайме. */
  public readonly baseColor: Color

  /** Закон реголита тела — тот же резолвер, что у шейдера диска. */
  private readonly regolith: RegolithParams

  private readonly scaleFactor: number
  private readonly bodyWorld = new Vector3()
  private readonly cameraWorld = new Vector3()

  public constructor(model: Actor, scaleFactor: number = 0.003) {
    super()
    this.model = model
    this.scaleFactor = scaleFactor
    this.baseColor = impostorColorFromActor(String(model.getAttribute('color', '')), config('planetImpostor.saturation'))
    this.regolith = regolithParamsOf(model)

    this.__setup()
  }

  __setup(): void {
    const map: Texture = resourceStorage.getTexture('star.png')!

    this.material = new SpriteMaterial({
      map,
      color: this.baseColor.clone(),
      sizeAttenuation: false,
      depthWrite: false,
      blending: AdditiveBlending
    })

    this.scale.multiplyScalar(this.scaleFactor)
  }

  public updateObject(ctx: UpdateContext): void {
    this.getWorldPosition(this.bodyWorld)
    ctx.camera.getWorldPosition(this.cameraWorld)

    const alpha = impostorPhaseAngle(this.bodyWorld, this.cameraWorld)
    const { regolithMix, oppositionSurge } = this.regolith
    // всплеск — только у тел под законом реголита, как гейт USE_REGOLITH на диске
    const surge = regolithMix > 0 ? oppositionSurge : 0
    const phase = Math.max(regolithPhase(alpha, regolithMix, surge), config('planetImpostor.phaseFloor'))
    const color = this.material.color.copy(this.baseColor).multiplyScalar(phase)

    // всплеск не уводит точку в блум: масштаб цвета целиком, оттенок сохраняется
    const peak = Math.max(color.r, color.g, color.b)
    if (peak > IMPOSTOR_MAX_CHANNEL) color.multiplyScalar(IMPOSTOR_MAX_CHANNEL / peak)
  }
}

export { FakePlanet }
