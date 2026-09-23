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
import { poolOf } from '../helpers/ringSystemInternals'
import { Actor } from '@/core/models/Actor'
import type { IRingRenderingObject } from '@/core/models/types'

const makeRingActor = (data: Partial<IRingRenderingObject> = {}): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1, ...data })
    },
    resources: {
      first: () => ({ getAttribute: () => 'ring.png' })
    }
  }) as unknown as Actor

describe('Кольцо: программы камней без ледяной примеси — побайтно прежние', () => {
  it('L0/Near и билборд кольца: тексты вершинника и фрагментника совпадают со снимком, дефайна нет', () => {
    const pool = poolOf(new AsteroidRingSystem(makeRingActor()))

    expect(pool.geometryMaterial.defines).not.toHaveProperty('USE_ICE_VARIETY')
    expect(pool.billboardMaterial.defines).not.toHaveProperty('USE_ICE_VARIETY')

    expect(pool.geometryMaterial.vertexShader).toMatchSnapshot('l0-vertex')
    expect(pool.geometryMaterial.fragmentShader).toMatchSnapshot('l0-fragment')
    expect(pool.billboardMaterial.vertexShader).toMatchSnapshot('billboard-vertex')
    expect(pool.billboardMaterial.fragmentShader).toMatchSnapshot('billboard-fragment')
  })
})
