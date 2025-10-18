import { RenderableObject } from '@/core/renderables/RenderableObject'
import { IRenderable } from '@/core/renderables/IRenderable'
import { Actor } from '@/core/models/Actor'
import { BufferGeometry, LOD, Mesh, Object3D, RingGeometry } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { RingMaterial } from '@/core/materials/RingMaterial'
import { degToRad } from 'three/src/math/MathUtils'
import { InstancedAsteroid } from '@/core/renderables/utils/InstancedAsteroid'

class Ring extends RenderableObject implements IRenderable {
  private readonly model: Actor

  public geometry: BufferGeometry
  public material: AbstractShaderMaterial
  public object3D: Object3D

  private asteroids: InstancedAsteroid

  public constructor(model: Actor) {
    super()
    this.model = model

    this.geometry = new RingGeometry(
      toThreeJSUnits(this.model.renderingObject.getAttribute('data').innerRadius),
      toThreeJSUnits(this.model.renderingObject.getAttribute('data').outerRadius),
      256
    )
    this.material = new RingMaterial(this.model)
    this.object3D = new Mesh(this.geometry, this.material)
    this.asteroids = new InstancedAsteroid(
      this.model.renderingObject.getAttribute('data').innerRadius,
      this.model.renderingObject.getAttribute('data').outerRadius,
      this.model.renderingObject.getAttribute('data').countParticles
    )
  }

  public build(): Object3D {
    this.object3D.rotateX(degToRad(-this.model.parent.physicalObject.getAttribute('axialTilt', 0)))

    const lod: LOD = new LOD()
    const simpleRing: Object3D = this.object3D
    const detailedRing: Object3D = simpleRing.clone().add(this.asteroids.build())

    lod.name = this.model.getAttribute('name') + 'Ring'
    lod.addLevel(detailedRing)
    lod.addLevel(simpleRing, toThreeJSUnits(this.model.renderingObject.getAttribute('data').outerRadius * 2))

    return lod
  }

  public update(delta?: number): void {
    //this.asteroids.update(delta)
  }
}

export { Ring }
