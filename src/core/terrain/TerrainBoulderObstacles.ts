import { Matrix3, Matrix4, Object3D, Ray, Sphere, Vector3 } from 'three'

const registry = new WeakMap<object, TerrainBoulderObstacles>()
export const boulderObstaclesFor = (actor: object): TerrainBoulderObstacles | undefined => registry.get(actor)
export function registerBoulderObstacles(actor: object, obstacles: TerrainBoulderObstacles): () => void {
  registry.set(actor, obstacles)
  return () => {
    if (registry.get(actor) === obstacles) registry.delete(actor)
  }
}

/** Bounded conservative proxies in the actual terrain host's coordinates, including camera clearance. */
export class TerrainBoulderObstacles {
  public spheres: readonly Sphere[] = []
  private readonly inverse = new Matrix4()
  private readonly normalMatrix = new Matrix3()
  private readonly ray = new Ray()
  private readonly end = new Vector3()
  private readonly point = new Vector3()
  private readonly local = new Vector3()
  private readonly direction = new Vector3()

  public constructor(private readonly host: Object3D) {}

  public intersect(ray: Ray, distance: number, point: Vector3, normal: Vector3): number | null {
    if (this.spheres.length === 0 || distance <= 0) return null
    this.host.updateWorldMatrix(true, false)
    this.inverse.copy(this.host.matrixWorld).invert()
    this.ray.copy(ray).applyMatrix4(this.inverse)
    this.end.copy(ray.origin).addScaledVector(ray.direction, distance).applyMatrix4(this.inverse)
    const length = this.end.distanceTo(this.ray.origin)
    let nearest = Infinity
    for (const sphere of this.spheres) {
      // Initial overlap belongs to pushOut, matching the terrain collision contract.
      if (sphere.containsPoint(this.ray.origin) || !this.ray.intersectSphere(sphere, this.point)) continue
      const t = this.point.distanceTo(this.ray.origin) / length
      if (t > 1 || t >= nearest) continue
      nearest = t
      point.copy(this.point)
      normal.subVectors(this.point, sphere.center).normalize()
    }
    if (!Number.isFinite(nearest)) return null
    point.applyMatrix4(this.host.matrixWorld)
    normal.applyMatrix3(this.normalMatrix.getNormalMatrix(this.host.matrixWorld)).normalize()
    return nearest
  }

  public pushOut(point: Vector3): boolean {
    if (this.spheres.length === 0) return false
    this.host.updateWorldMatrix(true, false)
    this.inverse.copy(this.host.matrixWorld).invert()
    this.local.copy(point).applyMatrix4(this.inverse)
    if (!this.spheres.some((sphere) => this.local.distanceToSquared(sphere.center) < sphere.radius ** 2)) return false
    // Resolve the connected union along the outward radial ray. Sequential nearest-sphere
    // pushes can oscillate between overlapping proxies and can also push into the ground.
    this.direction.copy(this.local).normalize()
    if (this.direction.lengthSq() === 0) this.direction.set(0, 1, 0)
    const intervals: { start: number; end: number }[] = []
    for (const sphere of this.spheres) {
      this.point.subVectors(sphere.center, this.local)
      const projection = this.point.dot(this.direction)
      const discriminant = sphere.radius ** 2 - (this.point.lengthSq() - projection ** 2)
      if (discriminant < 0) continue
      const halfChord = Math.sqrt(discriminant)
      if (projection + halfChord >= 0) intervals.push({ start: projection - halfChord, end: projection + halfChord })
    }
    intervals.sort((a, b) => a.start - b.start)
    let exit = 0
    for (const interval of intervals) {
      if (interval.start > exit + 1e-12) break
      exit = Math.max(exit, interval.end)
    }
    this.local.addScaledVector(this.direction, exit + Math.max(1e-12, exit * 1e-6))
    point.copy(this.local).applyMatrix4(this.host.matrixWorld)
    return true
  }
}
