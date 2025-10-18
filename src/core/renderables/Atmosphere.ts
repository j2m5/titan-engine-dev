import { RenderableObject } from '@/core/renderables/RenderableObject'
import { IRenderable } from '@/core/renderables/IRenderable'
import { Actor } from '@/core/models/Actor'
import { BufferGeometry, Mesh, Object3D, SphereGeometry } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { RenderingObject } from '@/core/models/RenderingObject'
import { AtmosphereMaterial } from '@/core/materials/AtmosphereMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { degToRad } from 'three/src/math/MathUtils'

class Atmosphere extends RenderableObject implements IRenderable {
  private readonly model: Actor
  private readonly renderingObject: RenderingObject

  public geometry: BufferGeometry
  public material: AbstractShaderMaterial
  public object3D: Object3D

  public constructor(model: Actor) {
    super()
    this.model = model
    this.renderingObject = RenderingObject.find(this.model.renderingObject.getAttribute('id'))!

    this.geometry = new SphereGeometry(toThreeJSUnits(this.renderingObject.getAttribute('data').radius), 128, 128)
    this.material = new AtmosphereMaterial(this.model)
    this.object3D = new Mesh(this.geometry, this.material)
  }

  public build(): Object3D {
    this.object3D.name = this.model.getAttribute('name') + 'Atmosphere'
    this.object3D.rotateX(degToRad(-90))

    return this.object3D
  }
}

export { Atmosphere }
