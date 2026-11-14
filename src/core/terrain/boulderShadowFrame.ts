import { Matrix4, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'

export const BOULDER_SHADOW_SIZE = 2048
export const BOULDER_SHADOW_WIDTH_METERS = 2048
export const BOULDER_SHADOW_DEPTH_METERS = 8192
export const BOULDER_SHADOW_FADE_METERS = [700, 1000] as const
const UNIT = toThreeJSUnits(0.001)
const finite = (v: Vector3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)

/** Double-precision body-local frame; the shadow scene itself contains only small RTC coordinates. */
export class BoulderShadowFrame {
  public constructor(private readonly sizeScale = 1) {}
  public readonly origin = new Vector3()
  public readonly right = new Vector3()
  public readonly up = new Vector3()
  public readonly sun = new Vector3()
  public readonly relativeToShadow = new Matrix4()
  private readonly inverseHost = new Matrix4()
  private readonly viewToRelative = new Matrix4()

  public update(cameraLocal: Vector3, sunLocal: Vector3): boolean {
    if (!finite(cameraLocal) || !finite(sunLocal) || sunLocal.lengthSq() === 0) return false
    this.sun.copy(sunLocal).normalize()
    this.up.set(0, 1, 0)
    if (Math.abs(this.sun.y) > 0.98) this.up.set(0, 0, 1)
    this.right.crossVectors(this.up, this.sun).normalize()
    this.up.crossVectors(this.sun, this.right).normalize()
    const width = BOULDER_SHADOW_WIDTH_METERS * UNIT * this.sizeScale,
      depth = BOULDER_SHADOW_DEPTH_METERS * UNIT * this.sizeScale
    const texel = width / BOULDER_SHADOW_SIZE
    this.origin
      .copy(this.right)
      .multiplyScalar(Math.round(cameraLocal.dot(this.right) / texel) * texel)
      .addScaledVector(this.up, Math.round(cameraLocal.dot(this.up) / texel) * texel)
      .addScaledVector(this.sun, cameraLocal.dot(this.sun))
    const r = this.right,
      u = this.up,
      s = this.sun
    this.relativeToShadow.set(
      r.x / width,
      r.y / width,
      r.z / width,
      0.5,
      u.x / width,
      u.y / width,
      u.z / width,
      0.5,
      -s.x / depth,
      -s.y / depth,
      -s.z / depth,
      0.5,
      0,
      0,
      0,
      1
    )
    return true
  }

  public viewToShadow(hostMatrix: Matrix4, cameraMatrix: Matrix4, out: Matrix4): Matrix4 {
    this.viewToRelative.multiplyMatrices(this.inverseHost.copy(hostMatrix).invert(), cameraMatrix)
    const e = this.viewToRelative.elements
    e[12] -= this.origin.x
    e[13] -= this.origin.y
    e[14] -= this.origin.z
    return out.multiplyMatrices(this.relativeToShadow, this.viewToRelative)
  }
}
