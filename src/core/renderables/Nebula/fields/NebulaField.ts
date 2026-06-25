import { Vector3 } from 'three'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { fbm3 } from '@/core/renderables/Nebula/fields/valueNoise'

// Disk vertical falloff is steeper than radial so a disk reads as genuinely
// flatter than an ellipsoid at equal axisRatios.
const DISK_VERTICAL_STEEPNESS = 2

function smoothstep(edge0: number, edge1: number, x: number): number {
  const width = edge1 - edge0
  if (width <= 1e-8) {
    return x < edge0 ? 0 : 1
  }
  const t = Math.min(1, Math.max(0, (x - edge0) / width))
  return t * t * (3 - 2 * t)
}

export class NebulaField {
  private readonly p: NebulaParams
  private readonly invAxis: Vector3

  public constructor(params: NebulaParams) {
    this.p = params
    this.invAxis = new Vector3(
      1 / Math.max(1e-4, params.axisRatios.x),
      1 / Math.max(1e-4, params.axisRatios.y),
      1 / Math.max(1e-4, params.axisRatios.z)
    )
  }

  /** Analytic shape falloff in local space [-1,1]; no noise. Returns [0,1]. */
  public boundary(p: Vector3): number {
    const x = p.x * this.invAxis.x
    const y = p.y * this.invAxis.y
    const z = p.z * this.invAxis.z

    if (this.p.shape === 'disk') {
      const r = Math.sqrt(x * x + z * z)
      const radial = 1 - smoothstep(1 - this.p.edgeFalloff, 1, r)
      const vertical = 1 - smoothstep(1 - this.p.edgeFalloff * DISK_VERTICAL_STEEPNESS, 1, Math.abs(y))
      return Math.max(0, radial * vertical)
    }

    const r = Math.sqrt(x * x + y * y + z * z)
    return 1 - smoothstep(1 - this.p.edgeFalloff, 1, r)
  }

  private noiseField(p: Vector3): number {
    const n = this.p.noise
    // domain warp
    const wx = fbm3({ x: p.x + 11.3, y: p.y, z: p.z }, this.p.seed + 101, 3, n.lacunarity, n.gain)
    const wy = fbm3({ x: p.x, y: p.y + 7.7, z: p.z }, this.p.seed + 202, 3, n.lacunarity, n.gain)
    const wz = fbm3({ x: p.x, y: p.y, z: p.z + 19.1 }, this.p.seed + 303, 3, n.lacunarity, n.gain)
    const qx = p.x + n.warpStrength * wx
    const qy = p.y + n.warpStrength * wy
    const qz = p.z + n.warpStrength * wz

    let base = fbm3({ x: qx * n.frequency, y: qy * n.frequency, z: qz * n.frequency }, this.p.seed, n.octaves, n.lacunarity, n.gain)
    // billow <-> ridged mix
    const billow = Math.abs(base)
    const ridged = 1 - Math.abs(base)
    base = (1 - n.ridged) * billow + n.ridged * ridged
    return Math.min(1, Math.max(0, base))
  }

  /** Full density pipeline. Extended by later tasks. Returns [0,1]. */
  public sampleDensity(p: Vector3): number {
    const b = this.boundary(p)
    if (b <= 0) return 0
    const noise = this.noiseField(p)
    let d = b * noise
    d = Math.pow(d, this.p.noise.contrast)
    return Math.min(1, Math.max(0, d))
  }
}
