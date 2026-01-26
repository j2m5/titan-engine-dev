import { AdditiveBlending, Sprite, SpriteMaterial, Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import { Colorable } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { colorTemperatureToRGB, rgbToHex } from '@/core/materials/shaders/lib/helpers'

class FakeStar extends Sprite {
  public model: Actor
  declare public material: SpriteMaterial

  private readonly scaleFactor: number

  public constructor(model: Actor, scaleFactor: number = 0.05) {
    super()
    this.model = model
    this.scaleFactor = scaleFactor

    this.__setup()
  }

  __setup(): void {
    const map: Texture = resourceStorage.getTexture('sun_glow.png')!
    const temperature: number = this.model.physicalObject!.getAttribute('temperature') || 5700
    const rgb: Colorable = colorTemperatureToRGB(temperature)
    const color: string = rgbToHex(rgb)

    this.material = new SpriteMaterial({
      map,
      color,
      sizeAttenuation: false,
      depthWrite: false,
      blending: AdditiveBlending
    })

    this.scale.multiplyScalar(this.scaleFactor)
  }
}

export { FakeStar }
