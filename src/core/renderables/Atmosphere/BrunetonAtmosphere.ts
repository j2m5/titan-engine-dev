import { BufferGeometry, Mesh, SphereGeometry, Vector3 } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Actor } from '@/core/models/Actor'
import { BrunetonAtmosphereMaterial } from '@/core/renderables/Atmosphere/BrunetonAtmosphereMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { threeJS } from '@/core/graphic/ThreeJS'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'

class BrunetonAtmosphere extends Mesh implements Acceptable<IObject3DVisitor> {
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
    const radius: number = toThreeJSUnits(this.model.renderingObject?.getAttribute('data').topRadius)

    const lutGenerator = new AtmosphereLUTGenerator(threeJS.renderer)
    const lut = lutGenerator.generate(this.model.renderingObject?.getAttribute('data'))

    this.geometry = new SphereGeometry(radius, 256, 256)

    this.material = new BrunetonAtmosphereMaterial(this.model)
    this.material.bindLUTTextures(lut)

    this.name = this.model.getAttribute('name') + 'Atmosphere'
  }

  public updateObject(delta?: number): void {
    this.material.update(this, threeJS.camera, this.lightPosition)
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitComponent(this)
  }
}

export { BrunetonAtmosphere }
