import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { BedrockField, bedrockProfile, bedrockProfileDerivative } from '@/core/terrain/bedrockField'
import { MIDBAND_DEFAULTS, midbandCacheKey, resolveMidbandParams } from '@/core/terrain/midbandParams'
import { BEDROCK_SHAPE, bedrockJoint, bedrockJointDerivative } from '@/core/terrain/bedrockShape'

const R = 3_390_000
const params = { ...MIDBAND_DEFAULTS, bedrockStrength: 0.45, bedrockStepMeters: 800 }

describe('weathered bedrock', () => {
  it('keeps angular joints C1 with the gradient and curvature used by collision bounds', () => {
    const e = BEDROCK_SHAPE.jointRound
    for (const knot of [-1, 0, e, 0.5 - e, 0.5, 0.5 + e, 1 - e, 1]) {
      expect(Math.abs(bedrockJoint(knot + 1e-7) - bedrockJoint(knot - 1e-7))).toBeLessThan(1e-6)
      expect(Math.abs(bedrockJointDerivative(knot + 1e-7) - bedrockJointDerivative(knot - 1e-7))).toBeLessThan(1e-5)
    }
    for (let i = -500; i <= 1500; i++) {
      const p = i / 1000,
        eps = 1e-6
      expect(Math.abs(bedrockJoint(p))).toBeLessThanOrEqual(1)
      expect(Math.abs(bedrockJointDerivative(p))).toBeLessThanOrEqual(4)
      expect(bedrockJointDerivative(p)).toBeCloseTo((bedrockJoint(p + eps) - bedrockJoint(p - eps)) / (2 * eps), 4)
      expect(
        Math.abs(bedrockJointDerivative(p + eps) - bedrockJointDerivative(p - eps)) / (2 * eps)
      ).toBeLessThanOrEqual(4 / e + 1e-5)
    }
  })
  it('validates coverage and separates the cached physical fields', () => {
    for (const bedrockWeathering of [-0.01, 1.01, NaN, Infinity, 'weathered'])
      expect(() => resolveMidbandParams({ bedrockWeathering }, 'Mars')).toThrow(/bedrockWeathering/)
    const old = resolveMidbandParams(params, 'Mars')
    const weathered = resolveMidbandParams({ ...params, bedrockWeathering: 1 }, 'Mars')
    expect(old.bedrockWeathering).toBe(0)
    expect(weathered.bedrockWeathering).toBe(1)
    expect(midbandCacheKey(weathered)).not.toBe(midbandCacheKey(old))
  })

  it('deposits material below the wall and removes it from the lower riser', () => {
    expect(bedrockProfile(0.3, 1) - bedrockProfile(0.3, 0)).toBeGreaterThan(0.1)
    expect(bedrockProfile(0.5, 1)).toBeLessThan(-0.1)
  })

  it.each([0, 0.35, 1])('preserves volume, ordering and C1 joins at weathering %s', (weathering) => {
    let mean = 0
    for (let i = 0; i < 10000; i++) {
      const p = i / 10000
      mean += bedrockProfile(p, weathering) / 10000
      expect(bedrockProfileDerivative(p, weathering)).toBeGreaterThanOrEqual(-1)
      expect(Math.abs(bedrockProfile(p, weathering))).toBeLessThanOrEqual(0.5)
      const numeric = (bedrockProfile(p + 1e-7, weathering) - bedrockProfile(p - 1e-7, weathering)) / 2e-7
      expect(bedrockProfileDerivative(p, weathering)).toBeCloseTo(numeric, 4)
    }
    expect(Math.abs(mean)).toBeLessThan(1e-9)
    for (const p of [-1, 0, 0.08, 0.3, 0.4025, 0.42, 0.7, 0.7225, 1]) {
      expect(Math.abs(bedrockProfile(p + 1e-7, weathering) - bedrockProfile(p - 1e-7, weathering))).toBeLessThan(1e-6)
      expect(
        Math.abs(bedrockProfileDerivative(p + 1e-7, weathering) - bedrockProfileDerivative(p - 1e-7, weathering))
      ).toBeLessThan(1e-4)
    }
  })

  it.each([0.35, 1])('matches the physical gradient and signed cap bounds at weathering %s', (bedrockWeathering) => {
    const field = new BedrockField({ ...params, bedrockWeathering }, R)
    const sample = (d: Vector3, h: number, env: number) => {
      const out = { heightMeters: 0, tiltE: 0, tiltN: 0 }
      field.addSample(d, h, env, 0.7, -0.21, 2e-5, -1e-5, out)
      return out
    }
    for (let i = 0; i < 200; i++) {
      const d = new Vector3(Math.cos(i * 0.091), Math.sin(i * 0.37) * 0.9, Math.sin(i * 0.091)).normalize()
      const east = new Vector3(0, 1, 0).cross(d).normalize(),
        north = d.clone().cross(east)
      const h = -3000 + i * 37,
        env = 0.7,
        actual = sample(d, h, env)
      for (const [tangent, mapGrad, envGrad, tilt] of [
        [east, 0.7, 2e-5, actual.tiltE],
        [north, -0.21, -1e-5, actual.tiltN]
      ] as const) {
        const eps = 0.05
        const a = sample(
          d
            .clone()
            .addScaledVector(tangent, eps / R)
            .normalize(),
          h + eps * mapGrad,
          env + eps * envGrad
        )
        const b = sample(
          d
            .clone()
            .addScaledVector(tangent, -eps / R)
            .normalize(),
          h - eps * mapGrad,
          env - eps * envGrad
        )
        expect(tilt).toBeCloseTo((a.heightMeters - b.heightMeters) / (2 * eps), 5)
      }
      const cos = Math.hypot(d.x, d.z)
      const bounds = field.range(
        { min: h - 50, max: h + 50 },
        { min: 0.6, max: 0.8 },
        d,
        120 / R,
        Math.max(0, cos - 120 / R),
        Math.min(1, cos + 120 / R),
        { min: 0, max: 0 }
      )
      for (const offset of [-100, -30, 0, 30, 100]) {
        const p = d
            .clone()
            .addScaledVector(east, offset / R)
            .normalize(),
          height = h + offset * 0.4
        const value = sample(p, height, field.envelope(0.7, height, Math.hypot(p.x, p.z))).heightMeters
        expect(value).toBeGreaterThanOrEqual(bounds.min)
        expect(value).toBeLessThanOrEqual(bounds.max)
      }
    }
  })
})
