import { AdditiveBlending, Sprite, SpriteMaterial, Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import { Colorable } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { colorTemperatureToRGB, rgbToHex } from '@/core/materials/shaders/lib/helpers'

class StarInnerLayer extends Sprite {
  public model: Actor
  declare public material: SpriteMaterial

  private readonly scaleFactor: number

  public constructor(model: Actor, scaleFactor: number = 0.8) {
    super()
    this.model = model
    this.scaleFactor = scaleFactor

    this.__setup()
  }

  __setup(): void {
    const map: Texture = resourceStorage.getTexture('sun.png')!
    const temperature: number = this.model.physicalObject?.getAttribute('temperature', 5700)
    const rgb: Colorable = colorTemperatureToRGB(temperature)
    const color: string = rgbToHex(rgb)

    this.material = new SpriteMaterial({
      map,
      color,
      opacity: 0.03,
      sizeAttenuation: false,
      blending: AdditiveBlending
    })

    this.scale.multiplyScalar(this.scaleFactor)
  }
}

export { StarInnerLayer }
