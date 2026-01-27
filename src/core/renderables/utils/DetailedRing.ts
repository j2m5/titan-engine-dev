import { Group, Matrix4, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { InstancedAsteroid } from '@/core/renderables/InstancedAsteroid'
import { degToRad, randFloat } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'

class DetailedRing extends Group {
  public model: Actor

  private readonly innerRadius: number
  private readonly outerRadius: number
  private readonly countInstances: number
  private countSectors: number = 12
  private vertex: Vector3 = new Vector3()
  private angleStart: number = 0
  private angleEnd: number = 0

  public constructor(model: Actor) {
    super()
    this.model = model

    this.innerRadius = this.model.renderingObject!.getAttribute('data').innerRadius
    this.outerRadius = this.model.renderingObject!.getAttribute('data').outerRadius
    this.countInstances = this.model.renderingObject!.getAttribute('data').countParticles

    this.__setup()
  }

  __setup(): void {
    const matrix: Matrix4 = new Matrix4()
    const instancesPerSector: number = Math.ceil(this.countInstances / this.countSectors)

    for (let i: number = 0; i < this.countSectors; i++) {
      this.angleStart = (360 / this.countSectors) * i
      this.angleEnd = (360 / this.countSectors) * (i + 1)

      const mesh: InstancedAsteroid = new InstancedAsteroid(instancesPerSector)

      mesh.name = 'AsteroidsSector' + (i + 1)

      for (let j: number = 0; j < instancesPerSector; j++) {
        const position: Vector3 = this.generatePosition()

        matrix.setPosition(position)
        mesh.setMatrixAt(j, matrix)
      }

      mesh.instanceMatrix.needsUpdate = true
      mesh.userData.center = this.getSectorCenter()

      this.add(mesh)
    }
  }

  private generatePosition(): Vector3 {
    const radius: number = randFloat(toThreeJSUnits(this.innerRadius), toThreeJSUnits(this.outerRadius))
    const angle: number = randFloat(degToRad(this.angleStart), degToRad(this.angleEnd))
    const x: number = Math.cos(angle) * radius
    const y: number = Math.sin(angle) * radius
    const z: number = randFloat(-70, 70)

    this.vertex.set(x, y, toThreeJSUnits(z))

    return this.vertex
  }

  private getSectorCenter(): Vector3 {
    const innerRadius: number = toThreeJSUnits(this.innerRadius)
    const outerRadius: number = toThreeJSUnits(this.outerRadius)

    const averageRadius: number = (innerRadius + outerRadius) / 2
    const theta: number = degToRad((this.angleStart + this.angleEnd) / 2)

    const x: number = averageRadius * Math.cos(theta)
    const y: number = averageRadius * Math.sin(theta)

    return new Vector3(x, y, 0)
  }
}

export { DetailedRing }
