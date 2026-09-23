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
import { toThreeJSUnits } from '@/core/helpers/scaling'
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

describe('AsteroidRingSystem: rockFog — туман на камнях без объёма пыли', () => {
  it('dustEnabled: false без rockFog — прежнее поведение: без тумана, без объёма', () => {
    const system = new AsteroidRingSystem(makeBeltActor(), { dustEnabled: false, planetRadiusKm: 0 })
    const pool = poolOf(system)

    expect(pool.geometryMaterial.uniforms.uDustDensity.value).toBe(0)
    expect(pool.billboardMaterial.uniforms.uDustDensity.value).toBe(0)
    expect(internalsOf(system).dustVolume).toBeNull()
  })

  it('dustEnabled: false + rockFog — туман на камнях есть, объёма всё равно нет', () => {
    const rangeKm = 40000
    const nearFadeFraction = 0.05
    const system = new AsteroidRingSystem(makeBeltActor(), {
      dustEnabled: false,
      planetRadiusKm: 0,
      rockFog: { rangeKm, nearFadeFraction }
    })
    const pool = poolOf(system)
    const thicknessKm = internalsOf(system).config.thicknessKm

    const expectedDensity = 1 / toThreeJSUnits(rangeKm)
    const expectedNearFade = nearFadeFraction * toThreeJSUnits(rangeKm)
    const expectedScaleHeight = toThreeJSUnits(thicknessKm)

    for (const uniforms of [pool.geometryMaterial.uniforms, pool.billboardMaterial.uniforms]) {
      expect(uniforms.uDustDensity.value).toBeCloseTo(expectedDensity, 10)
      expect(uniforms.uDustNearFade.value).toBeCloseTo(expectedNearFade, 10)
      expect(uniforms.uDustScaleHeight.value).toBeCloseTo(expectedScaleHeight, 10)
    }

    expect(internalsOf(system).dustVolume).toBeNull()
  })

  it('dustEnabled: true (кольцо) без rockFog — плотность и объём как раньше', () => {
    const system = new AsteroidRingSystem(makeBeltActor())
    const pool = poolOf(system)
    const cfg = internalsOf(system).config
    const inner = toThreeJSUnits(cfg.innerRadiusKm)
    const outer = toThreeJSUnits(cfg.outerRadiusKm)
    const expectedDensity = cfg.dustTauGrazing / (outer - inner)

    expect(pool.geometryMaterial.uniforms.uDustDensity.value).toBeCloseTo(expectedDensity, 10)
    expect(pool.billboardMaterial.uniforms.uDustDensity.value).toBeCloseTo(expectedDensity, 10)
    expect(internalsOf(system).dustVolume).not.toBeNull()
  })

  it('замкнутая форма τ = density × distance: на rangeKm туман набирает 1 − e⁻¹ ≈ 0.632', () => {
    const rangeKm = 40000
    const system = new AsteroidRingSystem(makeBeltActor(), {
      dustEnabled: false,
      planetRadiusKm: 0,
      rockFog: { rangeKm, nearFadeFraction: 0.05 }
    })
    const density = poolOf(system).geometryMaterial.uniforms.uDustDensity.value
    const distance = toThreeJSUnits(rangeKm)

    const tau = density * distance
    const fogFraction = 1 - Math.exp(-tau)

    expect(fogFraction).toBeCloseTo(1 - Math.exp(-1), 10)
  })
})
