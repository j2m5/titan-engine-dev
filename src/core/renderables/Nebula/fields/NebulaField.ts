import { Vector3 } from 'three'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
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
      const vertical = 1 - smoothstep(1 - this.p.edgeFalloff * 2, 1, Math.abs(y))
      return Math.max(0, radial * vertical)
    }

    const r = Math.sqrt(x * x + y * y + z * z)
    return 1 - smoothstep(1 - this.p.edgeFalloff, 1, r)
  }

  /** Full density pipeline. Extended by later tasks. Returns [0,1]. */
  public sampleDensity(p: Vector3): number {
    return this.boundary(p)
  }
}
