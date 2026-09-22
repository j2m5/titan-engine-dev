import { vi } from 'vitest'

const fakeTexture = { name: 'ring.png' }

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => fakeTexture,
    getTextureOrMake: () => fakeTexture
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { toThreeJSUnits, fromAstronomicalUnits } from '@/core/helpers/scaling'
import { AU } from '@/core/constants'
import { Actor } from '@/core/models/Actor'
import type { IRingRenderingObject } from '@/core/models/types'
import { internalsOf, poolOf } from '../helpers/ringSystemInternals'

/** Пояс: стаб-актор БЕЗ родителя-планеты (только renderingObject/resources) */
const makeBeltActor = (data: Partial<IRingRenderingObject> = {}): Actor =>
  ({
    getAttribute: () => 1,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1, ...data })
    },
    resources: {
      first: () => ({ getAttribute: () => 'ring.png' })
    }
  }) as unknown as Actor

/** Кольцо: стаб-актор с родителем-планетой заданного радиуса в км */
const makeRingActorWithParent = (radiusKm: number, data: Partial<IRingRenderingObject> = {}): Actor =>
  ({
    getAttribute: () => 1,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1, ...data })
    },
    resources: {
      first: () => ({ getAttribute: () => 'ring.png' })
    },
    parent: {
      physicalObject: {
        getAttribute: () => radiusKm
      }
    }
  }) as unknown as Actor

describe('AsteroidRingSystem: пояс без планеты — planetRadiusKm из конфига', () => {
  it('planetRadiusKm: 0 на стабе без родителя гасит uDustPlanetRadius во всех трёх материалах', () => {
    const system = new AsteroidRingSystem(makeBeltActor(), { planetRadiusKm: 0 })
    const pool = poolOf(system)

    expect(pool.geometryMaterial.uniforms.uDustPlanetRadius.value).toBe(0)
    expect(pool.billboardMaterial.uniforms.uDustPlanetRadius.value).toBe(0)

    const dustVolume = internalsOf(system).dustVolume
    expect(dustVolume).not.toBeNull()
    expect(dustVolume!.dustMaterial.uniforms.uDustPlanetRadius.value).toBe(0)
  })

  it('без planetRadiusKm кольцо с родителем-планетой сохраняет прежнее поведение (чтение родителя)', () => {
    const system = new AsteroidRingSystem(makeRingActorWithParent(60000))
    const pool = poolOf(system)
    const expected = toThreeJSUnits(60000)

    expect(pool.geometryMaterial.uniforms.uDustPlanetRadius.value).toBeCloseTo(expected, 10)
    expect(pool.billboardMaterial.uniforms.uDustPlanetRadius.value).toBeCloseTo(expected, 10)

    const dustVolume = internalsOf(system).dustVolume
    expect(dustVolume!.dustMaterial.uniforms.uDustPlanetRadius.value).toBeCloseTo(expected, 10)
  })
})

describe('AsteroidRingSystem: frame — плоскость системы вместо экваториальной', () => {
  it("frame: 'system' не поворачивает систему; дефолт 'equatorial' — поворот на 90°, как сегодня", () => {
    const belt = new AsteroidRingSystem(makeBeltActor(), { frame: 'system' })
    expect(belt.rotation.x).toBeCloseTo(0, 10)

    const ring = new AsteroidRingSystem(makeBeltActor())
    expect(ring.rotation.x).toBeCloseTo(Math.PI / 2, 10)
  })
})

describe('AsteroidRingSystem: bleedFraction — размытие кромок как доля ширины кольца', () => {
  it('bleedFraction задаёт bleedSigmaTu как долю ширины кольца в единицах сцены', () => {
    const innerAu = 42
    const outerAu = 58
    const data = { innerRadius: innerAu * AU, outerRadius: outerAu * AU }
    const width = fromAstronomicalUnits(outerAu - innerAu)

    const withFraction = new AsteroidRingSystem(makeBeltActor(data), {
      bleedFraction: { rocks: 0.02, dust: 0.05 }
    })
    const sigma = internalsOf(withFraction).bleedSigmaTu
    expect(sigma.rocks).toBeCloseTo(0.02 * width, 6)
    expect(sigma.dust).toBeCloseTo(0.05 * width, 6)
  })

  it('без bleedFraction сигмы остаются прежними — из ringGapBleedKm/dustBleedKm', () => {
    const system = new AsteroidRingSystem(makeBeltActor())
    const cfg = internalsOf(system).config
    const sigma = internalsOf(system).bleedSigmaTu

    expect(sigma.rocks).toBeCloseTo(toThreeJSUnits(cfg.ringGapBleedKm), 10)
    expect(sigma.dust).toBeCloseTo(toThreeJSUnits(cfg.dustBleedKm), 10)
  })
})

describe('AsteroidRingSystem: dustNearFadeFraction — ближнее гашение пыли как доля толщины', () => {
  it('dustNearFadeFraction: 0.25 задаёт uDustNearFade как долю толщины кольца', () => {
    const system = new AsteroidRingSystem(makeBeltActor(), { dustNearFadeFraction: 0.25 })
    const thicknessKm = internalsOf(system).config.thicknessKm
    const expected = 0.25 * toThreeJSUnits(thicknessKm)

    expect(internalsOf(system).dustVolume!.dustMaterial.uniforms.uDustNearFade.value).toBeCloseTo(expected, 6)
  })

  it('без dustNearFadeFraction uDustNearFade остаётся прежним — из dustNearFadeKm', () => {
    const system = new AsteroidRingSystem(makeBeltActor())
    const expected = toThreeJSUnits(internalsOf(system).config.dustNearFadeKm)

    expect(internalsOf(system).dustVolume!.dustMaterial.uniforms.uDustNearFade.value).toBeCloseTo(expected, 10)
  })
})
