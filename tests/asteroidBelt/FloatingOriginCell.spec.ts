import { describe, it, expect, vi } from 'vitest'

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
import { deriveCascades } from '@/core/renderables/DetailedRingStreamingSystem/cascadeScale'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import type { IRingRenderingObject } from '@/core/models/types'
import { internalsOf, originCellSizeOf } from '../helpers/ringSystemInternals'

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

describe('AsteroidRingSystem: ячейка плавающего начала', () => {
  it('с каскадами — ячейка САМОГО КРУПНОГО класса, а не самого мелкого', () => {
    const cascades = deriveCascades({ sizeRangeKm: [0.5, 60], spacingKm: 54, halfThicknessKm: 500 })
    // Каскады растут по индексу: последний обязан быть крупнее первого — иначе тест ничего не пинит
    expect(cascades[cascades.length - 1].cellSizeKm).toBeGreaterThan(cascades[0].cellSizeKm)

    const system = new AsteroidRingSystem(makeBeltActor(), { relativeOrigin: true, cascades })
    const floatingOrigin = internalsOf(system).floatingOrigin
    expect(floatingOrigin).not.toBeNull()

    const expectedCellTu = toThreeJSUnits(cascades[cascades.length - 1].cellSizeKm)
    expect(originCellSizeOf(floatingOrigin!)).toBeCloseTo(expectedCellTu, 9)

    // И явно НЕ ячейка самого мелкого каскада (иначе переезд был бы в 24 раза чаще)
    const smallestCellTu = toThreeJSUnits(cascades[0].cellSizeKm)
    expect(originCellSizeOf(floatingOrigin!)).not.toBeCloseTo(smallestCellTu, 3)
  })

  it('без каскадов (путь колец) — прежняя cfg.cellSizeKm', () => {
    const cellSizeKm = 2000
    const system = new AsteroidRingSystem(makeBeltActor(), { relativeOrigin: true, cellSizeKm })
    const floatingOrigin = internalsOf(system).floatingOrigin
    expect(floatingOrigin).not.toBeNull()

    expect(originCellSizeOf(floatingOrigin!)).toBeCloseTo(toThreeJSUnits(cellSizeKm), 9)
  })
})
