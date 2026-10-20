import { Vector3 } from 'three'
import { mergeNebulaParams, type NebulaShape } from '@/core/renderables/Nebula/NebulaParams'
import { nebulaParamsFromData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'

describe('directed nebula parameters', () => {
  it('defaults to an identity transform and clones the direction', () => {
    const base = mergeNebulaParams()
    expect(base.structure).toEqual({ direction: new Vector3(0, 1, 0), stretch: 1 })
    const copy = mergeNebulaParams({}, base)
    copy.structure.direction.x = 2
    expect(base.structure.direction).toEqual(new Vector3(0, 1, 0))
  })

  it('merges partial vectors, normalizes and preserves caller-owned values', () => {
    const direction = new Vector3(0, 3, 4)
    const base = mergeNebulaParams({ structure: { direction, stretch: 5 } })
    const result = mergeNebulaParams({ structure: { direction: { x: 1 } } }, base)
    expect(base.structure.direction.distanceTo(new Vector3(0, 0.6, 0.8))).toBeLessThan(1e-14)
    expect(result.structure.direction.distanceTo(new Vector3(1, 0.6, 0.8).normalize())).toBeLessThan(1e-14)
    expect(result.structure.stretch).toBe(5)
    expect(direction).toEqual(new Vector3(0, 3, 4))
  })

  it.each([new Vector3(), new Vector3(NaN, 1, 0), new Vector3(1, Infinity, 0)])('falls back to Y for unusable direction %s', direction => {
    expect(mergeNebulaParams({ structure: { direction } }).structure.direction).toEqual(new Vector3(0, 1, 0))
  })

  it.each([1e-300, 1e300])('normalizes finite directions at scale %s without under/overflow', scale => {
    const p = mergeNebulaParams({ structure: { direction: new Vector3(scale, -scale, 0) } })
    expect(p.structure.direction.distanceTo(new Vector3(Math.SQRT1_2, -Math.SQRT1_2, 0))).toBeLessThan(1e-14)
  })

  it.each([[0, 1], [-2, 1], [20, 16], [NaN, 1], [Infinity, 1], [3.5, 3.5]])('sanitizes stretch %s to %s', (stretch, expected) => {
    expect(mergeNebulaParams({ structure: { stretch } }).structure.stretch).toBe(expected)
  })

  it('accepts JSON direction triples and preserves preset/default filling', () => {
    const p = nebulaParamsFromData({ preset: 'dark', structure: { direction: [4, 0, 0], stretch: 6 } })
    expect(p.structure).toEqual({ direction: new Vector3(1, 0, 0), stretch: 6 })
    expect(p.density).toBe(0)
    expect(nebulaParamsFromData({ structure: { stretch: 3 } }).structure.direction).toEqual(new Vector3(0, 1, 0))
  })
})

describe('directed CPU medium field', () => {
  const points = Array.from({ length: 17 }, (_, i) => new Vector3(Math.sin(i) * 0.4, Math.cos(i * 1.3) * 0.4, Math.sin(i * 0.7) * 0.4))
  const base = () => mergeNebulaParams({
    seed: 23, axisRatios: new Vector3(3, 3, 3),
    noise: { boundaryWarp: 0, warpStrength: 0.45, contrast: 1.4 },
    dust: { seed: 91, frequency: 2, threshold: 0.4 }
  })

  it.each([new Vector3(0, 1, 0), new Vector3(1, 2, -0.3)])('stretches gas, its warp and independent dust along %s', direction => {
    const original = base()
    const directed = mergeNebulaParams({ structure: { direction, stretch: 6 } }, original)
    const isotropicField = new NebulaField(original), directedField = new NebulaField(directed)
    const axis = direction.clone().normalize()
    for (const point of points) {
      const before = point.clone()
      const q = point.clone().addScaledVector(axis, -point.dot(axis) * (1 - 1 / 6))
      expect(directedField.sampleDensity(point)).toBeCloseTo(isotropicField.sampleDensity(q), 12)
      expect(directedField.sampleDustDensity(point)).toBeCloseTo(isotropicField.sampleDustDensity(q), 12)
      expect(point).toEqual(before)
    }
  })

  it('treats opposite axes identically and stretch1 as identity', () => {
    const original = base()
    const forward = new NebulaField(mergeNebulaParams({ structure: { direction: new Vector3(2, 3, -1), stretch: 7 } }, original))
    const backward = new NebulaField(mergeNebulaParams({ structure: { direction: new Vector3(-2, -3, 1), stretch: 7 } }, original))
    const identity = new NebulaField(mergeNebulaParams({ structure: { direction: new Vector3(2, 3, -1) } }, original))
    const isotropic = new NebulaField(original)
    for (const p of points) {
      expect(forward.sampleDensity(p)).toBe(backward.sampleDensity(p))
      expect(forward.sampleDustDensity(p)).toBe(backward.sampleDustDensity(p))
      expect(identity.sampleDensity(p)).toBe(isotropic.sampleDensity(p))
      expect(identity.sampleDustDensity(p)).toBe(isotropic.sampleDustDensity(p))
    }
  })

  it.each<NebulaShape>(['ellipsoid', 'disk', 'shell', 'torus', 'hourglass'])('keeps the warped %s envelope in object coordinates', shape => {
    const p = mergeNebulaParams({ shape, noise: { boundaryWarp: 0.4 }, shapeRotation: new Vector3(0.2, 0.3, 0.4) })
    const a = new NebulaField(p), b = new NebulaField(mergeNebulaParams({ structure: { direction: new Vector3(1, 1, 0), stretch: 8 } }, p))
    for (const point of points) expect(b.boundaryAt(point)).toBe(a.boundaryAt(point))
    for (const point of [new Vector3(3, 3, 3), new Vector3(-3, -3, -3)]) {
      expect(b.sampleDensity(point)).toBe(0)
      expect(b.sampleDustDensity(point)).toBe(0)
    }
  })

  it('keeps analytic cavity and lobe centres in object coordinates', () => {
    const center = new Vector3(0.35, 0.1, -0.2)
    const p = mergeNebulaParams({
      structure: { direction: new Vector3(1, 0, 0), stretch: 8 },
      noise: { ridged: 0, contrast: 1 },
      cavities: [{ center, radius: 0.1, strength: 1 }]
    }, base())
    const carved = new NebulaField(p)
    expect(carved.sampleDensity(center)).toBe(0)
    expect(carved.sampleDustDensity(center)).toBe(0)
    const empty = mergeNebulaParams({ cavities: [] }, p)
    const lobe = new NebulaField(mergeNebulaParams({ lobes: [{ center, radius: 0.05, weight: 0.1 }] }, empty))
    expect(lobe.sampleDensity(center) - new NebulaField(empty).sampleDensity(center)).toBeCloseTo(0.1, 12)
  })
})
