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
import { deriveCascades, PIXEL_RAD } from '@/core/renderables/DetailedRingStreamingSystem/cascadeScale'
import type { BeltPointLayer } from '@/core/renderables/DetailedRingStreamingSystem/BeltPointLayer'
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
  it('дефолты: толща 0.06 (лента едва заметна: ~6% сверху), клочья 0.7 силы и 0.6 а.е.', () => {
    const p = asteroidBeltParameters(actorOf({ ...DATA, dustTauVertical: undefined, dustScaleHeightFraction: undefined }))
    expect(p.dustTauVertical).toBe(0.06)
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

  it('угловой гейт выключен: степень почти 0 даёт единицу с любого угла, но не ровно 0 — pow(0, 0) не определён', () => {
    const belt = new AsteroidBelt(actorOf(DATA))
    const power = dustOf(belt).dustMaterial.uniforms.uDustAnglePower.value as number
    expect(power).toBeGreaterThan(0)
    expect(power).toBeLessThan(1e-3)
    // Гейт колец: pow(1 − |dir.y|, power) — под углом 60° над плоскостью почти единица
    expect(Math.pow(0.5, power)).toBeGreaterThan(0.99999)
  })

  it('толща 0 в данных — плотность 0, лента невидима', () => {
    const belt = new AsteroidBelt(actorOf({ ...DATA, dustTauVertical: 0 }))
    expect(dustOf(belt).dustMaterial.uniforms.uDustDensity.value).toBe(0)
  })
})

describe('AsteroidBelt: клочья дымки доходят до объёма', () => {
  it('сила и масштаб из данных — в юниформах, дефайн клочьев стоит', () => {
    const belt = new AsteroidBelt(actorOf({ ...DATA, dustClumpStrength: 0.7, dustClumpScaleAu: 0.6 }))
    const material = dustOf(belt).dustMaterial

    expect(material.uniforms.uDustClumpStrength.value).toBe(0.7)
    expect(material.uniforms.uDustClumpScale.value).toBeCloseTo(toThreeJSUnits(0.6 * AU), 6)
    expect(material.defines.DUST_CLUMPS).toBe('1')
  })

  it('сила 0 — ровная лента, дефайна нет', () => {
    const belt = new AsteroidBelt(actorOf({ ...DATA, dustClumpStrength: 0 }))
    expect(dustOf(belt).dustMaterial.defines.DUST_CLUMPS).toBeUndefined()
  })
})

describe('AsteroidBelt: размер точки дальнего слоя — физический', () => {
  const pointsOf = (belt: AsteroidBelt): BeltPointLayer => (belt as unknown as { pointLayer: BeltPointLayer }).pointLayer

  it('масштаб спрайта = типичное тело крупнейшего класса в единицах сцены на пиксель', () => {
    const belt = new AsteroidBelt(actorOf(DATA))
    const largest = deriveCascades({ sizeRangeKm: [0.5, 60], spacingKm: 54, halfThicknessKm: 0.05 * AU }).at(-1)!
    const expected = toThreeJSUnits(largest.typicalSizeKm) / PIXEL_RAD

    expect(pointsOf(belt).pointMaterial.uniforms.uPointScale.value).toBeCloseTo(expected, 9)
  })

  it('на пороге билборда крупнейшего класса точка ровно один пиксель — продолжает билборд без скачка', () => {
    const belt = new AsteroidBelt(actorOf(DATA))
    const scale = pointsOf(belt).pointMaterial.uniforms.uPointScale.value as number
    const largest = deriveCascades({ sizeRangeKm: [0.5, 60], spacingKm: 54, halfThicknessKm: 0.05 * AU }).at(-1)!
    const l1 = toThreeJSUnits(largest.lodThresholdsKm.l1)

    // trueSize = size · (uPointScale / z) при size 1 и z = порог билборда
    expect(scale / l1).toBeCloseTo(1, 9)
  })

  it('ручка pointScale — множитель поверх физики', () => {
    const belt = new AsteroidBelt(actorOf({ ...DATA, pointScale: 3 }))
    const plain = new AsteroidBelt(actorOf(DATA))
    const scaled = pointsOf(belt).pointMaterial.uniforms.uPointScale.value as number
    const base = pointsOf(plain).pointMaterial.uniforms.uPointScale.value as number

    expect(scaled / base).toBeCloseTo(3, 9)
  })
})
