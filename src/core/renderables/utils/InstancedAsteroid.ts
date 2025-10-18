import { IRenderable } from '@/core/renderables/IRenderable'
import { BufferGeometry, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Object3D, Vector3 } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { threeJS } from '@/core/graphic/ThreeJS'
import { degToRad, randFloat } from 'three/src/math/MathUtils'

class InstancedAsteroid implements IRenderable {
  public geometry: BufferGeometry
  public material: AbstractShaderMaterial
  public object3D: Object3D
  private readonly innerRadius: number
  private readonly outerRadius: number
  private readonly countInstances: number
  private countSectors: number = 12
  private vertex: Vector3 = new Vector3()
  private angleStart: number = 0
  private angleEnd: number = 0

  public constructor(innerRadius: number, outerRadius: number, countInstances: number) {
    this.innerRadius = innerRadius
    this.outerRadius = outerRadius
    this.countInstances = countInstances
    this.geometry = new IcosahedronGeometry(toThreeJSUnits(5))
    this.material = new InstancedAsteroidMaterial()
    this.object3D = new Group()
  }

  public build(): Object3D {
    const matrix: Matrix4 = new Matrix4()
    const instancesPerSector: number = Math.ceil(this.countInstances / this.countSectors)

    for (let i: number = 0; i < this.countSectors; i++) {
      this.angleStart = (360 / this.countSectors) * i
      this.angleEnd = (360 / this.countSectors) * (i + 1)

      const mesh: InstancedMesh = new InstancedMesh(this.geometry, this.material, instancesPerSector)

      mesh.name = 'AsteroidsSector' + (i + 1)

      for (let j: number = 0; j < instancesPerSector; j++) {
        const position: Vector3 = this.generatePosition()

        matrix.setPosition(position)
        mesh.setMatrixAt(j, matrix)
      }

      mesh.instanceMatrix.needsUpdate = true
      mesh.userData.center = this.getSectorCenter()

      this.object3D.add(mesh)
    }

    return this.object3D
  }

  public update(delta?: number): void {
    this.object3D.children.forEach((el: Object3D): void => {
      const center: Vector3 = el.userData.center.clone()
      const matrixWorld: Matrix4 = el.matrixWorld
      const centerWorld: Vector3 = center.applyMatrix4(matrixWorld)
      const distance: number = threeJS.camera.position.distanceTo(centerWorld)
      el.visible = distance <= toThreeJSUnits(15000)
    })
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

export { InstancedAsteroid }
