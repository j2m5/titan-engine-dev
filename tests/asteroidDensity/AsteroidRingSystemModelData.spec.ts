import { vi, type Mock } from 'vitest'
import { Color } from 'three'

const fakeTexture = { name: 'ring.png' }

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => fakeTexture,
    getTextureOrMake: () => fakeTexture
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null)
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { readRingAlphaProfile, readRingAlphaBins } from '@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback'
import { ASTEROID_PROFILES } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import type { IRingRenderingObject } from '@/core/models/types'

const makeFakeActor = (data: Partial<IRingRenderingObject> = {}): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1, ...data })
    },
    resources: {
      first: () => ({ getAttribute: () => 'ring.png' })
    }
  }) as unknown as Actor

/* eslint-disable @typescript-eslint/no-explicit-any -- доступ к приватным полям в тестах, как в соседних спеках */

describe('AsteroidRingSystem: визуальные ручки из модельного слоя (IRingRenderingObject.data)', () => {
  beforeEach(() => {
    ;(readRingAlphaProfile as Mock).mockClear()
    ;(readRingAlphaBins as Mock).mockClear()
  })

  it('ringGapBleedKm и dustBleedKm из data пробрасываются в размытие профилей', () => {
    const system = new AsteroidRingSystem(makeFakeActor({ ringGapBleedKm: 777, dustBleedKm: 1234 }))
    ;(system as any).__tryBuildDensityProfile()

    expect(readRingAlphaProfile).toHaveBeenCalledWith(fakeTexture, expect.any(Number), expect.any(Number), {
      alphaTest: 0.1,
      blurRadius: toThreeJSUnits(777)
    })
    expect(readRingAlphaBins).toHaveBeenCalledWith(fakeTexture, expect.any(Number), expect.any(Number), {
      blurRadius: toThreeJSUnits(1234)
    })
  })

  it('profile из data задаёт облик камней; неизвестное имя тихо падает в дефолт', () => {
    const icy = new AsteroidRingSystem(makeFakeActor({ profile: 'icy' }))
    const icyColor = (icy as any).pool.geometryMesh.material.uniforms.uRockColor.value
    expect(icyColor.getHex()).toBe(new Color(ASTEROID_PROFILES.icy.baseColor).getHex())

    const typo = new AsteroidRingSystem(makeFakeActor({ profile: 'plasma' }))
    const typoColor = (typo as any).pool.geometryMesh.material.uniforms.uRockColor.value
    expect(typoColor.getHex()).toBe(new Color(ASTEROID_PROFILES.stony.baseColor).getHex())
  })

  it('пылевые ручки: цвет строкой, tau-калибровка, полутолщина слоя', () => {
    const system = new AsteroidRingSystem(
      makeFakeActor({ dustColor: '#ff0000', dustTauGrazing: 0.9, dustScaleHeightKm: 500 })
    )
    const u = (system as any).pool.billboardMaterial.uniforms
    expect(u.uDustColor.value.getHex()).toBe(0xff0000)
    const width = u.uDustRingOuter.value - u.uDustRingInner.value
    expect(u.uDustDensity.value).toBeCloseTo(0.9 / width, 10)
    expect(u.uDustScaleHeight.value).toBeCloseTo(toThreeJSUnits(500), 10)
  })

  it('thicknessKm и asteroidSizeKm из data влияют на генератор и геометрию', () => {
    const system = new AsteroidRingSystem(makeFakeActor({ thicknessKm: 800, asteroidSizeKm: 25 }))
    expect((system as any).generator.config.thickness).toBeCloseTo(toThreeJSUnits(800), 10)

    // L0-геометрия теперь запечённый архетип-осколок (BufferGeometry без .parameters) —
    // форма зависит только от профиля, а asteroidSizeKm — чистый множитель масштаба.
    // Проверяем пропорциональность масштаба радиусу, не завязываясь на конкретные
    // числа вершин архетипа.
    const baseline = new AsteroidRingSystem(makeFakeActor())
    const maxRadius = (sys: AsteroidRingSystem): number => {
      const pos = (sys as any).pool.geometryMesh.geometry.getAttribute('position')
      let max = 0
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i))
        if (r > max) max = r
      }
      return max
    }
    expect(maxRadius(system) / maxRadius(baseline)).toBeCloseTo(25 / 10, 6)
  })

  it('dustEnabled: false из data выключает объём дымки', () => {
    const system = new AsteroidRingSystem(makeFakeActor({ dustEnabled: false }))
    expect(system.children.find((c) => c.name === 'RingDustVolume')).toBeUndefined()
  })

  it('приоритет: configOverrides (код) > данные модели > дефолты', () => {
    const system = new AsteroidRingSystem(makeFakeActor({ ringGapBleedKm: 777 }), { ringGapBleedKm: 50 })
    expect((system as any).config.ringGapBleedKm).toBe(50)

    // Незаданные в data поля не затирают дефолты
    const plain = new AsteroidRingSystem(makeFakeActor())
    expect((plain as any).config.ringGapBleedKm).toBe(300)
    expect((plain as any).config.dustBleedKm).toBe(600)
  })
})
