import { IRenderable } from '@/core/renderables/IRenderable'
import { AdditiveBlending, Object3D, Sprite, SpriteMaterial, Texture } from 'three'
import { getTextureByKey } from '@/config/textures'

class FakePlanet implements IRenderable {
  private readonly scale: number
  public material: SpriteMaterial
  public object3D: Object3D

  public constructor(scale: number = 0.002) {
    this.scale = scale

    const map: Texture = getTextureByKey('star.png')!

    this.material = new SpriteMaterial({
      map,
      color: '#96948b',
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

export { FakePlanet }
