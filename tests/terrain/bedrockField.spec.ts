import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { BedrockField, bedrockProfile, bedrockProfileDerivative } from '@/core/terrain/bedrockField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'

const R = 3_390_000
const params = { ...MIDBAND_DEFAULTS, bedrockStrength: 0.6, bedrockStepMeters: 800 }
const direction = new Vector3(0.3, 0.4, 0.8).normalize()
const sample = (field: BedrockField, dir = direction, height = 3100, envelope = 0.8) => {
  const out = { heightMeters: 0, tiltE: 0, tiltN: 0 }
  field.addSample(dir, height, envelope, 0, 0, 0, 0, out)
  return out
}

describe('bedrock shelves and risers', () => {
  it.each([
    [0, 0],
    [0.25, -0.25],
    [0.5, 0],
    [0.75, 0.25],
    [1, 0],
    [-0.25, 0.25]
  ])('remaps phase %s by %s while preserving the layer endpoints', (phase, displacement) => {
    expect(bedrockProfile(phase)).toBeCloseTo(displacement, 12)
  })

  it('makes broad benches and steeper risers without reversing the elevation ordering', () => {
    expect(1 + 0.6 * bedrockProfileDerivative(0.1)).toBeCloseTo(0.4, 12)
    expect(1 + 0.6 * bedrockProfileDerivative(0.5)).toBeGreaterThan(2.5)
    let mean = 0
    for (let i = 0; i < 10000; i++) {
      const phase = i / 10000
      mean += bedrockProfile(phase) / 10000
      expect(1 + bedrockProfileDerivative(phase)).toBeGreaterThanOrEqual(0)
      expect(Math.abs(bedrockProfile(phase))).toBeLessThanOrEqual(0.5)
    }
    expect(Math.abs(mean)).toBeLessThan(1e-12)
  })

  it.each([0, 0.3, 0.7, 1, -1])('joins both height and tilt continuously at phase %s', (p) => {
    expect(Math.abs(bedrockProfile(p + 1e-7) - bedrockProfile(p - 1e-7))).toBeLessThan(1e-6)
    expect(Math.abs(bedrockProfileDerivative(p + 1e-7) - bedrockProfileDerivative(p - 1e-7))).toBeLessThan(1e-4)
  })

  it('differentiates the height phase, spatial warp and varying coverage together', () => {
    const field = new BedrockField(params, R)
    const east = new Vector3(0, 1, 0).cross(direction).normalize()
    const north = direction.clone().cross(east)
    const h = 3110,
      env = 0.7,
      mapE = 0.65,
      mapN = -0.24,
      envE = 2e-5,
      envN = -1e-5
    const out = { heightMeters: 0, tiltE: 0, tiltN: 0 }
    field.addSample(direction, h, env, mapE, mapN, envE, envN, out)
    for (const [tangent, mapGrad, envGrad, tilt] of [
      [east, mapE, envE, out.tiltE],
      [north, mapN, envN, out.tiltN]
    ] as const) {
      const epsilon = 0.01
      const a = sample(
        field,
        direction
          .clone()
          .addScaledVector(tangent, epsilon / R)
          .normalize(),
        h + epsilon * mapGrad,
        env + epsilon * envGrad
      )
      const b = sample(
        field,
        direction
          .clone()
          .addScaledVector(tangent, -epsilon / R)
          .normalize(),
        h - epsilon * mapGrad,
        env - epsilon * envGrad
      )
      expect(tilt).toBeCloseTo((a.heightMeters - b.heightMeters) / (2 * epsilon), 6)
    }
  })

  it('keeps flats, the shoreline and poles quiet, and removes unresolved detail', () => {
    const field = new BedrockField({ ...params, waterLevelMeters: 0 }, R)
    expect(field.envelope(0.05, 1000, 1)).toBe(0)
    expect(field.envelope(1, 0, 1)).toBe(0)
    expect(field.envelope(1, 1000, 0)).toBe(0)
    expect(field.envelope(0.8, 1000, 1)).toBeGreaterThan(0.9)
    expect(Math.abs(sample(field).heightMeters)).toBeGreaterThan(1)
    expect(sample(field, direction, 3100, field.envelope(0.8, 3100, 1, 800)).heightMeters).toBe(0)
    for (const step of [0, 80, 162, 325, 650]) {
      expect(
        Math.abs(
          sample(field).heightMeters -
            sample(field, direction, 3100, 0.8 * field.envelope(0.8, 3100, 1, step)).heightMeters
        )
      ).toBeLessThanOrEqual(field.residualAmplitudeMeters(step) + 1e-9)
    }
  })

  it('bounds signed displacement over an arc and converges as the interval shrinks', () => {
    const field = new BedrockField(params, R)
    const end = direction
      .clone()
      .add(new Vector3(0.0002, -0.0001, 0))
      .normalize()
    const center = direction.clone().add(end).normalize()
    const chord = Math.max(center.distanceTo(direction), center.distanceTo(end)) + 1e-12
    const bounds = field.range({ min: 2850, max: 3900 }, { min: 0.3, max: 0.9 }, center, chord, 0.8, 1, {
      min: 0,
      max: 0
    })
    for (let i = 0; i <= 300; i++) {
      const t = i / 300,
        d = direction.clone().lerp(end, t).normalize(),
        height = 2850 + 1050 * t
      const env = field.envelope(0.3 + 0.6 * t, height, Math.hypot(d.x, d.z))
      const h = sample(field, d, height, env).heightMeters
      expect(h).toBeGreaterThanOrEqual(bounds.min)
      expect(h).toBeLessThanOrEqual(bounds.max)
    }
    const cosLat = Math.hypot(direction.x, direction.z)
    const point = field.range({ min: 3100, max: 3100 }, { min: 0.6, max: 0.6 }, direction, 1e-13, cosLat, cosLat, {
      min: 0,
      max: 0
    })
    const actual = sample(field, direction, 3100, field.envelope(0.6, 3100, cosLat)).heightMeters
    expect(point.min).toBeLessThanOrEqual(actual)
    expect(point.max).toBeGreaterThanOrEqual(actual)
    expect(point.max - point.min).toBeLessThan(1e-5)
  })
})
