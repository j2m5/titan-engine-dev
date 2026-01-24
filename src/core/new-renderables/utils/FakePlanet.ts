import { AdditiveBlending, Sprite, SpriteMaterial, Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'

class FakePlanet extends Sprite {
  public model: Actor
  declare public material: SpriteMaterial

  private readonly scaleFactor: number

  public constructor(model: Actor, scaleFactor: number = 0.003) {
    super()
    this.model = model
    this.scaleFactor = scaleFactor

    this.__setup()
  }

  __setup(): void {
    const map: Texture = resourceStorage.getTexture('star.png')!

    this.material = new SpriteMaterial({
      map,
      color: '#d5d5d5',
      sizeAttenuation: false,
      depthWrite: false,
      blending: AdditiveBlending
    })

    this.scale.multiplyScalar(this.scaleFactor)
  }
}

export { FakePlanet }
