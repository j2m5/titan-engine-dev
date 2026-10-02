import { AdditiveBlending, Color, Sprite, SpriteMaterial, Texture, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { config } from '@/core/framework/config'
import { impostorColorFromActor, impostorPhaseAngle, lambertPhase } from '@/core/renderables/utils/planetImpostorMath'
import type { UpdateContext } from '@/core/UpdateContext'

/**
 * Точка планеты дальше порога LOD: цвет тела из Actor.color и фаза по углу
 * звезда–тело–камера (звезда в нуле сцены). В полной фазе яркость прежняя.
 */
class FakePlanet extends Sprite {
  public model: Actor
  declare public material: SpriteMaterial

  /** Линейный цвет полной фазы — считается один раз: актор не меняет цвет в рантайме. */
  public readonly baseColor: Color

  private readonly scaleFactor: number
  private readonly bodyWorld = new Vector3()
  private readonly cameraWorld = new Vector3()

  public constructor(model: Actor, scaleFactor: number = 0.003) {
    super()
    this.model = model
    this.scaleFactor = scaleFactor
    this.baseColor = impostorColorFromActor(String(model.getAttribute('color', '')), config('planetImpostor.saturation'))

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

    const phase = Math.max(lambertPhase(impostorPhaseAngle(this.bodyWorld, this.cameraWorld)), config('planetImpostor.phaseFloor'))

    this.material.color.copy(this.baseColor).multiplyScalar(phase)
  }
}

export { FakePlanet }
