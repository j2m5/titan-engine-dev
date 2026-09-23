import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { BeltPointLayer } from '@/core/renderables/DetailedRingStreamingSystem/BeltPointLayer'
import { AngularDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/AngularDensityProfile'
import {
  buildBeltAngularProfile,
  buildBeltDensityProfile
} from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'

const TWO_PI = Math.PI * 2
const INNER = 40
const OUTER = 60
const flat = { edgeSoftness: 0, gaps: [], clumps: [] }
const FLAT_PROFILE = buildBeltDensityProfile(flat)
/** Дуга на четверти оборота (θ₀ = π/2) */
const ARC = { at: 0.25, width: 0.05, gain: 2 }

function baseParams(overrides: Partial<ConstructorParameters<typeof BeltPointLayer>[0]> = {}) {
  return {
    innerR: INNER,
    outerR: OUTER,
    halfThickness: 1,
    count: 500,
    seed: 7,
    profile: FLAT_PROFILE,
    color: new Color(0x6b6157),
    lightTint: { active: false, color: new Color(1, 1, 1) },
    pointScale: 220,
    maxDistance: 12000,
    ...overrides
  }
}

const positionsOf = (layer: BeltPointLayer): Float32Array =>
  layer.geometry.getAttribute('position').array as Float32Array

/** Угол точки — тем же atan2(z, x), что у камеры стримера (AsteroidRingSystem) */
const angleOf = (positions: Float32Array, i: number): number => {
  const theta = Math.atan2(positions[i * 3 + 2], positions[i * 3])
  return theta < 0 ? theta + TWO_PI : theta
}

describe('BeltPointLayer: дуги — распределение по углу следует профилю', () => {
  it('доля точек в окне дуги равна массе профиля на окне (±5%), напротив дуги — меньше', () => {
    const count = 60000
    const angularProfile = buildBeltAngularProfile({ ...flat, arcs: [ARC] })!
    const layer = new BeltPointLayer(baseParams({ count, seed: 11, angularProfile }))
    const positions = positionsOf(layer)
    const profile = new AngularDensityProfile(angularProfile)

    const halfWindow = ARC.width * TWO_PI
    const lo = Math.PI / 2 - halfWindow
    const hi = Math.PI / 2 + halfWindow
    let inArc = 0
    let opposite = 0
    for (let i = 0; i < count; i++) {
      const theta = angleOf(positions, i)
      if (theta >= lo && theta <= hi) inArc++
      if (theta >= lo + Math.PI && theta <= hi + Math.PI) opposite++
    }

    const expected = count * profile.weightForRange(lo, hi) * ((hi - lo) / TWO_PI)
    expect(Math.abs(inArc - expected) / expected).toBeLessThan(0.05)
    expect(inArc / opposite).toBeGreaterThan(1.5)
  })

  it('все точки по-прежнему внутри тора', () => {
    const angularProfile = buildBeltAngularProfile({ ...flat, arcs: [ARC] })!
    const positions = positionsOf(new BeltPointLayer(baseParams({ count: 2000, angularProfile })))
    for (let i = 0; i < 2000; i++) {
      const r = Math.hypot(positions[i * 3], positions[i * 3 + 2])
      expect(r).toBeGreaterThanOrEqual(INNER - 1e-6)
      expect(r).toBeLessThanOrEqual(OUTER + 1e-6)
    }
  })
})

describe('BeltPointLayer: без дуг поток rng и позиции прежние', () => {
  it('angularProfile не задан, undefined и null — побитово одни позиции и размеры', () => {
    const plain = new BeltPointLayer(baseParams({ count: 400, seed: 42 }))
    const undefinedProfile = new BeltPointLayer(baseParams({ count: 400, seed: 42, angularProfile: undefined }))
    const nullProfile = new BeltPointLayer(baseParams({ count: 400, seed: 42, angularProfile: null }))

    expect(positionsOf(undefinedProfile)).toEqual(positionsOf(plain))
    expect(positionsOf(nullProfile)).toEqual(positionsOf(plain))
    expect(nullProfile.geometry.getAttribute('size').array).toEqual(plain.geometry.getAttribute('size').array)
  })

  it('с дугой тратится ровно один rng на угол: радиусы, высоты и размеры точек те же, что без дуги', () => {
    const angularProfile = buildBeltAngularProfile({ ...flat, arcs: [ARC] })!
    const plain = new BeltPointLayer(baseParams({ count: 400, seed: 42 }))
    const arcs = new BeltPointLayer(baseParams({ count: 400, seed: 42, angularProfile }))
    const a = positionsOf(plain)
    const b = positionsOf(arcs)

    for (let i = 0; i < 400; i++) {
      expect(Math.hypot(b[i * 3], b[i * 3 + 2])).toBeCloseTo(Math.hypot(a[i * 3], a[i * 3 + 2]), 4)
      expect(b[i * 3 + 1]).toBe(a[i * 3 + 1])
    }
    expect(arcs.geometry.getAttribute('size').array).toEqual(plain.geometry.getAttribute('size').array)
  })
})
