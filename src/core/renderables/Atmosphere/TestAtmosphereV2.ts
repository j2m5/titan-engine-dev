import { BufferGeometry, Mesh, SphereGeometry, Vector3 } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Actor } from '@/core/models/Actor'
import { BrunetonAtmosphereMaterial } from '@/core/renderables/Atmosphere/BrunetonAtmosphereMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { degToRad } from 'three/src/math/MathUtils'
import { threeJS } from '@/core/graphic/ThreeJS'
import { dtLoader } from '@/core/renderables/Atmosphere/DTLoader'

class TestAtmosphereV2 extends Mesh implements Acceptable<IObject3DVisitor> {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: BrunetonAtmosphereMaterial

  private lightPosition: Vector3 = new Vector3()

  public constructor(model: Actor) {
    super()
    this.model = model

    this.__setup()
  }

  __setup(): void {
    const radius: number = toThreeJSUnits(this.model.renderingObject!.getAttribute('data').radius)

    this.geometry = new SphereGeometry(radius, 128, 128)

    this.material = new BrunetonAtmosphereMaterial()
    this.material.bindLUTTextures(dtLoader.textures)

    this.name = this.model.getAttribute('name') + 'Atmosphere'
    this.rotateX(degToRad(this.model.parent!.physicalObject!.getAttribute('axialTilt', 0)))
  }

  public updateObject(delta?: number): void {
    this.material.update(this, threeJS.camera, this.lightPosition)
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitComponent(this)
  }
}

export { TestAtmosphereV2 }
