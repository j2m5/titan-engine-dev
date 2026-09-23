import { vi } from 'vitest'
import { Vector3 } from 'three'

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
import { ROCK_FOG_SCALE_HEIGHT_FACTOR } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidRingSystem'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import type { IRingRenderingObject } from '@/core/models/types'
import { internalsOf, poolOf } from '../helpers/ringSystemInternals'
import { tauRay, type DustParams } from '../ringDust/tauMirror'

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
    const expectedScaleHeight = toThreeJSUnits(thicknessKm) * ROCK_FOG_SCALE_HEIGHT_FACTOR

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

  describe('замкнутая форма (tauRay — зеркало ringDustTauRay) на луче длиной rangeKm', () => {
    const rangeKm = 40000
    const system = new AsteroidRingSystem(makeBeltActor(), {
      dustEnabled: false,
      planetRadiusKm: 0,
      rockFog: { rangeKm, nearFadeFraction: 0.05 }
    })
    const uniforms = poolOf(system).geometryMaterial.uniforms
    // Юниформы, подключённые в rockFog-ветке, без профиля (readRingAlphaBins → null,
    // densityProfileSource не задан) — пыль по радиусу равномерная
    const params: DustParams = {
      rho0: uniforms.uDustDensity.value,
      H: uniforms.uDustScaleHeight.value,
      rIn: uniforms.uDustRingInner.value,
      rOut: uniforms.uDustRingOuter.value
    }
    const thickness = toThreeJSUnits(internalsOf(system).config.thicknessKm)
    const range = toThreeJSUnits(rangeKm)

    // Луч касательный от среднего радиуса: весь путь лежит в плоской зоне
    // маски кромок (smoothstep занимает 12% ширины у каждой кромки), маска
    // ровно 1 — τ определяется только плотностью и вертикальной экспонентой.
    // Ближний рамп (uDustNearFade) в tauRay не входит — он множитель fogAmount.
    const rMid = (params.rIn + params.rOut) / 2
    const origin = new Vector3(rMid, 0, 0)
    const dir = new Vector3(0, 0, 1)
    const edge = (params.rOut - params.rIn) * 0.12
    const rEnd = Math.hypot(rMid, range)

    it('луч целиком в плоской зоне маски кромок', () => {
      expect(rMid).toBeGreaterThan(params.rIn + edge)
      expect(rEnd).toBeLessThan(params.rOut - edge)
    })

    it('в средней плоскости τ = 1 → туман набирает 1 − e⁻¹ ≈ 0.632', () => {
      const { tau } = tauRay(origin.clone(), dir.clone(), range, params)

      expect(tau).toBeCloseTo(1, 3)
      expect(1 - Math.exp(-tau)).toBeCloseTo(1 - Math.exp(-1), 3)
    })

    it('на верхней кромке ленты (|y| = толщина/2) τ ≥ 0.9 — масштабная высота держит туман по всей высоте', () => {
      const top = origin.clone().setY(thickness / 2)
      const { tau } = tauRay(top, dir.clone(), range, params)

      expect(tau).toBeGreaterThanOrEqual(0.9)
      // Точное значение: exp(−(толщина/2) / (толщина · фактор))
      expect(tau).toBeCloseTo(Math.exp(-1 / (2 * ROCK_FOG_SCALE_HEIGHT_FACTOR)), 6)
    })
  })
})
