import { describe, it, expect, vi } from 'vitest'
import '@/core/framework/TitanThree'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => ({ name: 'r.png' }), getTextureOrMake: () => ({ name: 'r.png' }) }
}))
vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { asteroidBeltParameters } from '@/core/renderables/AsteroidBelt/AsteroidBeltParameters'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { AU } from '@/core/constants'
import { Actor } from '@/core/models/Actor'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'
import type { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'

const DATA: IAsteroidBeltRenderingObject = {
  innerRadiusAu: 40,
  outerRadiusAu: 60,
  thicknessAu: 0.1,
  sizeRangeKm: [0.5, 60],
  spacingKm: 54,
  dustEnabled: true,
  dustTauVertical: 0.35,
  dustScaleHeightFraction: 1 / 3
}

const actorOf = (data: IAsteroidBeltRenderingObject): Actor =>
  ({
    placement: null,
    renderingObject: { getAttribute: (): unknown => data },
    getAttribute: (k: string, f: unknown = ''): unknown => (k === 'categoryId' ? 11 : f)
  }) as unknown as Actor

const dustOf = (belt: AsteroidBelt): RingDustVolume => (belt as unknown as { dustVolume: RingDustVolume }).dustVolume

describe('asteroidBeltParameters: пыль пояса — толща по вертикали и клочья', () => {
  it('дефолты: толща 0.35, клочья 0.7 силы и 0.6 а.е.', () => {
    const p = asteroidBeltParameters(actorOf({ ...DATA, dustTauVertical: undefined, dustScaleHeightFraction: undefined }))
    expect(p.dustTauVertical).toBe(0.35)
    expect(p.dustClumpStrength).toBe(0.7)
    expect(p.dustClumpScaleKm).toBeCloseTo(0.6 * AU, 6)
  })

  it('клампы: толща не отрицательна, сила клочьев в [0, 1], масштаб не нулевой', () => {
    expect(asteroidBeltParameters(actorOf({ ...DATA, dustTauVertical: -1 })).dustTauVertical).toBe(0)
    expect(asteroidBeltParameters(actorOf({ ...DATA, dustClumpStrength: 3 })).dustClumpStrength).toBe(1)
    expect(asteroidBeltParameters(actorOf({ ...DATA, dustClumpStrength: -1 })).dustClumpStrength).toBe(0)
    expect(asteroidBeltParameters(actorOf({ ...DATA, dustClumpScaleAu: 0 })).dustClumpScaleKm).toBeGreaterThan(0)
  })
})

describe('AsteroidBelt: калибровка дымки по вертикали, без углового гейта', () => {
  it('толща сквозь слой сверху равна ручке: ∫ плотность·exp(−|y|/H) dy = dustTauVertical', () => {
    const belt = new AsteroidBelt(actorOf(DATA))
    const u = dustOf(belt).dustMaterial.uniforms
    const density = u.uDustDensity.value as number
    const scaleHeight = u.uDustScaleHeight.value as number

    // Численный интеграл по y от −12H до +12H (обрезка марша в шейдере)
    const steps = 20000
    const yMax = scaleHeight * 12
    const dy = (2 * yMax) / steps
    let tau = 0
    for (let i = 0; i < steps; i++) {
      const y = -yMax + (i + 0.5) * dy
      tau += density * Math.exp(-Math.abs(y) / scaleHeight) * dy
    }

    expect(tau).toBeCloseTo(0.35, 3)
  })

  it('масштабная полутолщина — доля полутолщины тора', () => {
    const belt = new AsteroidBelt(actorOf(DATA))
    const scaleHeight = dustOf(belt).dustMaterial.uniforms.uDustScaleHeight.value as number
    const halfThickness = toThreeJSUnits(0.1 * AU) * 0.5

    expect(scaleHeight).toBeCloseTo(halfThickness / 3, 6)
  })

  it('угловой гейт выключен: степень 0 даёт единицу с любого угла', () => {
    const belt = new AsteroidBelt(actorOf(DATA))
    expect(dustOf(belt).dustMaterial.uniforms.uDustAnglePower.value).toBe(0)
  })

  it('толща 0 в данных — плотность 0, лента невидима', () => {
    const belt = new AsteroidBelt(actorOf({ ...DATA, dustTauVertical: 0 }))
    expect(dustOf(belt).dustMaterial.uniforms.uDustDensity.value).toBe(0)
  })
})
