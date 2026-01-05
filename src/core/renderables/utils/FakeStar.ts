import { IRenderable } from '@/core/renderables/IRenderable'
import { AdditiveBlending, Object3D, Sprite, SpriteMaterial, Texture } from 'three'
import { getTextureByKey } from '@/config/textures'
import { Colorable } from '@/core/models/types'
import { colorTemperatureToRGB, rgbToHex } from '@/core/materials/shaders/lib/helpers'

class FakeStar implements IRenderable {
  private readonly scale: number
  public material: SpriteMaterial
  public object3D: Object3D

  public constructor(scale: number = 0.05) {
    this.scale = scale

    const map: Texture = getTextureByKey('sun_glow.png')!
    const rgb: Colorable = colorTemperatureToRGB(5700)
    const color: string = rgbToHex(rgb)

    this.material = new SpriteMaterial({
      map,
      color,
      sizeAttenuation: false,
      depthWrite: false,
      blending: AdditiveBlending
    })
    this.object3D = new Sprite(this.material)
  }

  public build(): Object3D {
    this.object3D.scale.multiplyScalar(this.scale)

    return this.object3D
  }

  public update(delta?: number): void {}
}

export { FakeStar }
