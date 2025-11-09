import { RenderableObject } from '@/core/renderables/RenderableObject'
import { IRenderable } from '@/core/renderables/IRenderable'
import { Actor } from '@/core/models/Actor'
import { PhysicalObject } from '@/core/models/PhysicalObject'
import { BufferGeometry, Group, LOD, Mesh, Object3D, SphereGeometry } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { NullPhysicalObject } from '@/core/models/defaults/NullPhysicalObject'
import { degToRad } from 'three/src/math/MathUtils'
import { FakePlanet } from '@/core/renderables/utils/FakePlanet'
import { timeStore } from '@/ui/mobX/TimeStore'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { AU, SpaceScale } from '@/core/constants'
import { config } from '@/core/framework/config'

class Planet extends RenderableObject implements IRenderable {
  private readonly model: Actor
  private readonly physicalObject: PhysicalObject

  private readonly keplerianModel: KeplerianModel

  public geometry: BufferGeometry
  public material: AbstractShaderMaterial
  public object3D: Object3D
  public group: Group

  public constructor(model: Actor) {
    super()
    this.model = model
    this.physicalObject = this.model.physicalObject || new NullPhysicalObject(this.model.getAttribute('id'))

    this.keplerianModel = new KeplerianModel(timeStore.epoch, this.model)

    this.geometry = new SphereGeometry(toThreeJSUnits(this.physicalObject.getAttribute('radius')), 256, 256)
    this.material = new PlanetMaterial(this.model)
    this.object3D = new Mesh(this.geometry, this.material)
    this.group = new Group()
  }

  public build(): Object3D {
    const lod: LOD = new LOD()

    this.object3D.name = this.model.getAttribute('name') + 'Base'
    lod.name = this.model.getAttribute('name') + 'LOD'
    lod.addLevel(this.object3D)
    lod.addLevel(new FakePlanet().build(), this.computeDistanceLOD())
    lod.userData.type = this.model.category.getAttribute('alias')
    lod.userData.model = this.model.getAttribute('name')

    this.object3D.rotateX(degToRad(-90))
    this.object3D.rotateX(degToRad(-this.model.physicalObject.getAttribute('axialTilt', 0)))

    this.group.name = this.model.getAttribute('name')

    this.group.add(lod)

    return this.group
  }

  private computeDistanceLOD(): number {
    const radius: number = this.physicalObject.getAttribute('radius')
    const fov: number = degToRad(config('camera.fov'))
    const pixels: number = 3

    return toThreeJSUnits((2 * radius * window.innerHeight) / (fov * pixels))
  }

  public update(delta?: number): void {
    const { position } = this.keplerianModel.getStateByEpoch(timeStore.epoch)
    this.group.position.copy(position).multiplyScalar(AU * SpaceScale)
  }
}

export { Planet }
