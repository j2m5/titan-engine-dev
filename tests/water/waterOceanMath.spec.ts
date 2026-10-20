import { describe, expect, it } from 'vitest'
import {
  oceanFresnel,
  oceanLayerOpacity,
  oceanSunGlint,
  sampleOceanSurface
} from '@/core/materials/shaders/lib/chunks/waterOceanMath'
import { WATER_DETAIL_WRAP_METERS, type Vec3 } from '@/core/materials/shaders/lib/chunks/waterOctavesMath'

const up: Vec3 = [0, 1, 0]
const point: Vec3 = [137.25, -412.75, 936.125]
const sample = (p = point, n = up, time = 3.7, footprint = 0.01, strength = 1) =>
  sampleOceanSurface(p, n, time, footprint, strength)

describe('ocean surface continuity', () => {
  it('does not repeat the same height tile every 160 metres', () => {
    // Regression: harmonically related crossing waves produced a visible waffle
    // pattern. Compare actual fields, not the generator's chosen wave parameters.
    for (const offset of [[160, 0, 0], [0, 0, 160]] as Vec3[]) {
      const values: number[] = []
      const shifted: number[] = []
      for (let z = 0; z < 24; z++) for (let x = 0; x < 24; x++) {
        const p: Vec3 = [x * 13.7 + 0.31, 0, z * 11.3 + 0.73]
        values.push(sample(p).height)
        shifted.push(sample(p.map((v, i) => v + offset[i]) as Vec3).height)
      }
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length
      const shiftedMean = shifted.reduce((sum, v) => sum + v, 0) / shifted.length
      let covariance = 0
      let variance = 0
      let shiftedVariance = 0
      for (let i = 0; i < values.length; i++) {
        const a = values[i] - mean, b = shifted[i] - shiftedMean
        covariance += a * b
        variance += a * a
        shiftedVariance += b * b
      }
      expect(covariance / Math.sqrt(variance * shiftedVariance)).toBeLessThan(0.85)
    }
  })

  it('does not change when neighboring patches use different wrapped origins', () => {
    const reference = sample()
    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [-1, 1]) {
        const shifted: Vec3 = [...point]
        shifted[axis] += sign * WATER_DETAIL_WRAP_METERS
        const actual = sample(shifted)
        expect(actual.height).toBeCloseTo(reference.height, 8)
        expect(actual.crest).toBeCloseTo(reference.crest, 8)
        actual.gradient.forEach((value, i) => expect(value).toBeCloseTo(reference.gradient[i], 8))
      }
    }
  })

  it('uses the derivative of its height field for the surface slope', () => {
    const epsilon = 1e-3
    for (const normal of [up, [1, 0, 0], [0, 0, -1], [-1 / Math.sqrt(3), 1 / Math.sqrt(3), -1 / Math.sqrt(3)]] as Vec3[]) {
      const surface = sample(point, normal)
      for (let axis = 0; axis < 3; axis++) {
        const tangent = normal.map((v, i) => (i === axis ? 1 : 0) - v * normal[axis])
        const plus = point.map((v, i) => v + epsilon * tangent[i]) as Vec3
        const minus = point.map((v, i) => v - epsilon * tangent[i]) as Vec3
        const derivative = (sample(plus, normal).height - sample(minus, normal).height) / (2 * epsilon)
        expect(surface.gradient[axis]).toBeCloseTo(derivative, 4)
      }
    }
  })

  it('keeps finite outward normals in every octant and at both poles', () => {
    const normals: Vec3[] = [[0, 1, 0], [0, -1, 0]]
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      normals.push([x / Math.sqrt(3), y / Math.sqrt(3), z / Math.sqrt(3)])
    }
    for (const n of normals) {
      const surface = sample(point, n, 36000)
      expect(surface.normal.every(Number.isFinite)).toBe(true)
      expect(Math.hypot(...surface.normal)).toBeCloseTo(1, 12)
      expect(surface.normal.reduce((sum, v, i) => sum + v * n[i], 0)).toBeGreaterThan(0.5)
      expect(surface.gradient.reduce((sum, v, i) => sum + v * n[i], 0)).toBeCloseTo(0, 10)
      expect(surface.crest).toBeGreaterThanOrEqual(0)
      expect(surface.crest).toBeLessThanOrEqual(1)
    }
  })

  it('animates the field using scene time and removes it at zero strength', () => {
    expect(Math.abs(sample().height - sample(point, up, 4.7).height)).toBeGreaterThan(0.01)
    expect(sample(point, up, 9, 0.01, 0)).toMatchObject({
      height: 0, gradient: [0, 0, 0], normal: up, crest: 0, variance: 0
    })
  })

  it('turns unresolved waves into roughness instead of aliasing', () => {
    const near = sample()
    const middle = sample(point, up, 3.7, 5)
    const far = sample(point, up, 3.7, 1000)
    expect(near.variance).toBe(0)
    expect(middle.variance).toBeGreaterThan(0)
    expect(far.variance).toBeGreaterThan(middle.variance)
    expect(far.height).toBe(0)
    expect(far.normal).toEqual(up)
    expect(far.crest).toBe(0)
  })
})

describe('near ocean optics', () => {
  it('uses the dielectric Fresnel for both reflection and transmitted coverage', () => {
    expect(oceanFresnel(1)).toBeCloseTo(0.02, 12)
    expect(oceanFresnel(0)).toBe(1)
    expect(oceanFresnel(0.5)).toBeCloseTo(0.050625, 12)
    expect(oceanLayerOpacity(0, 0.02)).toBeCloseTo(0.02, 12)
    expect(oceanLayerOpacity(0.5, 0.02)).toBeCloseTo(0.51, 12)
    expect(oceanLayerOpacity(1, 0.02)).toBe(1)
    expect(oceanLayerOpacity(0.5, 1)).toBe(1)
  })

  it('has no sun lobe on back-facing surfaces or below the lighting horizon', () => {
    expect(oceanSunGlint(-0.01, 0.5, 0.9, 0.7, 0.01)).toBe(0)
    expect(oceanSunGlint(0.5, 0, 0.9, 0.7, 0.01)).toBe(0)
    for (const mu of [1e-9, 0.001, 0.2, 1]) {
      expect(Number.isFinite(oceanSunGlint(mu, mu, 1, 1, 1e-8))).toBe(true)
      expect(oceanSunGlint(mu, mu, 1, 1, 1e-8)).toBeLessThanOrEqual(4)
    }
  })

  it('spreads the highlight as unresolved roughness grows', () => {
    expect(oceanSunGlint(1, 1, 1, 1, 0.001)).toBeGreaterThan(oceanSunGlint(1, 1, 1, 1, 0.1))
    expect(oceanSunGlint(0.7, 0.7, 0.9, 1, 0.1)).toBeGreaterThan(oceanSunGlint(0.7, 0.7, 0.9, 1, 0.001))
  })
})
