import { AxesHelper, BoxHelper, Euler, IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { threeJS } from '@/core/graphic/ThreeJS'

class AsteroidCluster extends InstancedMesh {
  public count: number
  public radius: number
  public thickness: number

  public constructor(count: number, radius: number, thickness: number) {
    super(new IcosahedronGeometry(toThreeJSUnits(20)), new InstancedAsteroidMaterial(), count)
    this.count = count
    this.radius = radius
    this.thickness = thickness

    this.__setup()
  }

  __setup(): void {
    const matrix = new Matrix4()
    const position = new Vector3()
    const rotation = new Euler()
    const scale = new Vector3()

    for (let i = 0; i < this.count; i++) {
      position.copy(this.randomPointInCell(this.radius, this.thickness))

      rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)

      const s = 0.6 + Math.random() * 0.8
      scale.set(s, s, s)

      matrix.compose(position, new Quaternion().setFromEuler(rotation), scale)
      this.setMatrixAt(i, matrix)
    }

    this.instanceMatrix.needsUpdate = true
    //this.position.set(0, 0, toThreeJSUnits(700000))
    console.log('created')
    const box = new BoxHelper(this)
    const axes = new AxesHelper(200)
    //this.add(axes)
    //this.add(box)
    //console.log(this)
  }

  public updateObject(delta?: number): void {
    const distance = this.position.distanceTo(threeJS.camera.position)

    //this.visible = distance < toThreeJSUnits(5000)
  }

  private randomPointInSphere(radius: number): Vector3 {
    const u = Math.random()
    const v = Math.random()

    const theta = 2 * Math.PI * u
    const phi = Math.acos(2 * v - 1)

    const sinPhi = Math.sin(phi)

    const dir = new Vector3(sinPhi * Math.cos(theta), sinPhi * Math.sin(theta), Math.cos(phi))

    const r = radius * Math.cbrt(Math.random())

    return dir.multiplyScalar(r)
  }

  private randomPointInCell(radius: number, height: number): Vector3 {
    const p = this.randomPointInSphere(radius)

    p.y *= height

    return p
  }
}

export { AsteroidCluster }
