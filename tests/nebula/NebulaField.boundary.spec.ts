import { Vector3 } from 'three'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

describe('NebulaField boundary', () => {
  it('is maximal at center and zero outside the proxy', () => {
    const field = new NebulaField(mergeNebulaParams({ shape: 'ellipsoid' }))
    expect(field.boundary(new Vector3(0, 0, 0))).toBeGreaterThan(0.5)
    expect(field.boundary(new Vector3(5, 0, 0))).toBe(0) // far outside [-1,1]
  })

  it('density stays within [0,1] across a grid', () => {
    const field = new NebulaField(mergeNebulaParams())
    for (let x = -1.5; x <= 1.5; x += 0.5)
      for (let y = -1.5; y <= 1.5; y += 0.5)
        for (let z = -1.5; z <= 1.5; z += 0.5) {
          const d = field.sampleDensity(new Vector3(x, y, z))
          expect(d).toBeGreaterThanOrEqual(0)
          expect(d).toBeLessThanOrEqual(1)
        }
  })

  it('disk is flatter along Y than ellipsoid for equal axisRatios', () => {
    const ell = new NebulaField(mergeNebulaParams({ shape: 'ellipsoid' }))
    const disk = new NebulaField(mergeNebulaParams({ shape: 'disk' }))
    const probe = new Vector3(0, 0.6, 0)
    expect(disk.boundary(probe)).toBeLessThan(ell.boundary(probe))
  })
})
