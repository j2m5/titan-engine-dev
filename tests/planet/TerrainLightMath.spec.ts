import { describe, expect, it } from 'vitest'
import { composeLegacy, composeTerrain, terrainLit, type Vec3 } from '@/core/materials/shaders/lib/chunks/terrainLightMath'

const grey = (v: number): [number, number, number] => [v, v, v]

describe('terrainLit: CPU-зеркало lit = mix(ambient·occ, directGain, max(N·L,0)), directGain = mix(1, occ, k)·cloudShadow', () => {
  it('полдень, occ = 1, без тени → ровно 1 (яркость тела не меняется)', () => {
    expect(terrainLit({ ndotl: 1, ambient: 0.15, skyTerm: grey(1), occlusion: 1, kDirect: 0.35, cloudShadow: 1, lambert: 1 })).toEqual(grey(1))
  })

  it('полдень, яма occ = 0.4, k = 0 → 1: окклюзия не гасит прямой свет', () => {
    expect(terrainLit({ ndotl: 1, ambient: 0.15, skyTerm: grey(1), occlusion: 0.4, kDirect: 0, cloudShadow: 1, lambert: 1 })).toEqual(grey(1))
  })

  it('тень (N·L ≤ 0) → ambient·skyTerm·occ покомпонентно', () => {
    // 0.2·0.75·0.5 не представимо в float64 ни при каком порядке множителей —
    // сверка покомпонентная, а не toEqual на литералы
    const lit = terrainLit({ ndotl: -0.2, ambient: 0.2, skyTerm: [0.5, 0.75, 1], occlusion: 0.5, kDirect: 0.35, cloudShadow: 1, lambert: 1 })
    for (const [i, expected] of [0.05, 0.075, 0.1].entries()) expect(lit[i]).toBeCloseTo(expected, 12)
  })

  it('k = 1 и серое небо — прежняя формула mix(ambientFloor, 1, N·L)·occ на прямом', () => {
    const ndotl = 0.6
    const prev = (0.15 * 1 + (1 - 0.15 * 1) * ndotl) // прежний множитель при occ = 1
    expect(terrainLit({ ndotl, ambient: 0.15, skyTerm: grey(1), occlusion: 1, kDirect: 1, cloudShadow: 1, lambert: 1 })[0]).toBeCloseTo(prev, 12)
  })

  it('lambert = 0 → множитель 1 при любых входах (легаси-вид)', () => {
    expect(terrainLit({ ndotl: 0.3, ambient: 0.15, skyTerm: grey(0.2), occlusion: 0.1, kDirect: 0.35, cloudShadow: 0.2, lambert: 0 })).toEqual(grey(1))
  })

  it('тень облаков множит только прямой свет', () => {
    const noon = terrainLit({ ndotl: 1, ambient: 0.15, skyTerm: grey(1), occlusion: 1, kDirect: 0.35, cloudShadow: 0.4, lambert: 1 })
    const shade = terrainLit({ ndotl: 0, ambient: 0.15, skyTerm: grey(1), occlusion: 1, kDirect: 0.35, cloudShadow: 0.4, lambert: 1 })
    expect(noon).toEqual(grey(0.4))
    expect(shade).toEqual(grey(0.15))
  })
})

describe('composeTerrain: терминатор гейтит облака и ночь, суша под ламбертом самогасится', () => {
  const base = { night: [0.1, 0.1, 0.1] as Vec3, cloudColor: [0.3, 0.3, 0.3] as Vec3, cloudAlpha: 0.5, dayColor: [0.6, 0.6, 0.6] as Vec3 }

  it('lambert = 0 — тождественна легаси mix(night, day, dayFactor)', () => {
    // toBeCloseTo, не toEqual: a·c + b·c ≠ (a+b)·c в float64 ни при каком порядке
    // множителей (см. terrainLit выше) — формулы алгебраически тождественны,
    // бит-в-бит не обязаны
    for (const dayFactor of [0, 0.3, 0.7, 1]) {
      const terrain = composeTerrain({ ...base, dayFactor, lambert: 0 })
      const legacy = composeLegacy({ ...base, dayFactor, lambert: 0 })
      for (const c of [0, 1, 2]) expect(terrain[c]).toBeCloseTo(legacy[c], 12)
    }
  })

  it('lambert = 1 — суша не множится на dayFactor, облака и ночь — множатся', () => {
    const out = composeTerrain({ ...base, dayFactor: 0.5, lambert: 1 })
    expect(out[0]).toBeCloseTo(0.1 * 0.5 + 0.3 * 0.5 + 0.6 * 0.5 * 1, 12)
  })
})
