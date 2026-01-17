import { IRenderable } from '@/core/renderables/IRenderable'
import { AdditiveBlending, Object3D, Sprite, SpriteMaterial, Texture } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'

class FakePlanet implements IRenderable {
  private readonly scale: number
  public material: SpriteMaterial
  public object3D: Object3D

  public constructor(scale: number = 0.003) {
    this.scale = scale

    const map: Texture = resourceStorage.getTexture('star.png')!

    this.material = new SpriteMaterial({
      map,
      color: '#d5d5d5',
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
