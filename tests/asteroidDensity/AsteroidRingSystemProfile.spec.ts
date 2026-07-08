import { vi, type Mock } from 'vitest'

const fakeTexture = { name: 'ring.png' }

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => fakeTexture,
    getTextureOrMake: () => fakeTexture
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(),
  readRingAlphaBins: vi.fn()
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { RadialDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/RadialDensityProfile'
import { readRingAlphaProfile, readRingAlphaBins } from '@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.2 })
    },
    resources: {
      first: () => ({ getAttribute: () => 'ring.png' })
    }
  }) as unknown as Actor

/* eslint-disable @typescript-eslint/no-explicit-any -- доступ к приватным полям в тестах, как в соседних спеках */

describe('AsteroidRingSystem: применение радиального профиля', () => {
  beforeEach(() => {
    ;(readRingAlphaProfile as Mock).mockReset()
    ;(readRingAlphaBins as Mock).mockReset()
    ;(readRingAlphaBins as Mock).mockReturnValue(null)
  })

  it('профиль построен → отдан гриду и генератору, опции readback из модели/конфига', () => {
    const profile = new RadialDensityProfile(new Float32Array([1, 0, 1]), 10, 20)
    ;(readRingAlphaProfile as Mock).mockReturnValue(profile)

    const system = new AsteroidRingSystem(makeFakeActor())
    ;(system as any).__tryBuildDensityProfile()

    expect((system as any).sectorGrid.densityProfile).toBe(profile)
    expect((system as any).generator.densityProfile).toBe(profile)

    // Опции readback: alphaTest кольца и размытие кромок из конфига (в TU)
    expect(readRingAlphaProfile).toHaveBeenCalledWith(fakeTexture, expect.any(Number), expect.any(Number), {
      alphaTest: 0.2,
      blurRadius: toThreeJSUnits(300)
    })
  })

  it('профиль нечитаем (null) → равномерная плотность, ретраев нет', () => {
    ;(readRingAlphaProfile as Mock).mockReturnValue(null)

    const system = new AsteroidRingSystem(makeFakeActor())
    ;(system as any).__tryBuildDensityProfile()

    expect((system as any).sectorGrid.densityProfile).toBeNull()
    expect((system as any).densityProfileReady).toBe(true)

    // Повторный вызов не перечитывает текстуру
    ;(system as any).__tryBuildDensityProfile()
    expect(readRingAlphaProfile).toHaveBeenCalledTimes(1)
  })

  it('профиль пыли: текстура и scale уходят в материалы камней и объём дымки', () => {
    ;(readRingAlphaProfile as Mock).mockReturnValue(null)
    ;(readRingAlphaBins as Mock).mockReturnValue(new Float32Array([1, 0, 0.5, 0.5]))

    const system = new AsteroidRingSystem(makeFakeActor())
    ;(system as any).__tryBuildDensityProfile()

    const l0Uniforms = (system as any).pool.geometryMesh.material.uniforms
    const l1Uniforms = (system as any).pool.billboardMaterial.uniforms
    const dustUniforms = (system as any).dustVolume.dustMaterial.uniforms
    for (const uniforms of [l0Uniforms, l1Uniforms, dustUniforms]) {
      expect(uniforms.uDustRadialMapScale.value).toBeGreaterThan(0)
      expect(uniforms.uDustRadialMap.value).not.toBeNull()
    }
    // Одна текстура на все три материала (единая модель RingDust)
    expect(l0Uniforms.uDustRadialMap.value).toBe(dustUniforms.uDustRadialMap.value)

    // Свой blur (dustBleedKm), БЕЗ порога alphaTest (тусклые полосы — тусклая пыль)
    expect(readRingAlphaBins).toHaveBeenCalledWith(fakeTexture, expect.any(Number), expect.any(Number), {
      blurRadius: toThreeJSUnits(600)
    })
  })

  it('профиль пыли нечитаем → модуляция выключена (равномерная пыль)', () => {
    ;(readRingAlphaProfile as Mock).mockReturnValue(null)
    ;(readRingAlphaBins as Mock).mockReturnValue(null)

    const system = new AsteroidRingSystem(makeFakeActor())
    ;(system as any).__tryBuildDensityProfile()

    const l1Uniforms = (system as any).pool.billboardMaterial.uniforms
    expect(l1Uniforms.uDustRadialMapScale.value).toBe(0)
    expect(l1Uniforms.uDustRadialMap.value).toBeNull()
  })

  it('ручка ringGapBleedKm пробрасывается в размытие профиля', () => {
    ;(readRingAlphaProfile as Mock).mockReturnValue(null)

    const system = new AsteroidRingSystem(makeFakeActor(), { ringGapBleedKm: 1000 })
    ;(system as any).__tryBuildDensityProfile()

    expect(readRingAlphaProfile).toHaveBeenCalledWith(fakeTexture, expect.any(Number), expect.any(Number), {
      alphaTest: 0.2,
      blurRadius: toThreeJSUnits(1000)
    })
  })
})
