import { describe, it, expect, vi } from 'vitest'

const fakeTexture = { name: 'any' }
vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => undefined, getTextureOrMake: () => fakeTexture }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { Actor } from '@/core/models/Actor'
import { internalsOf, generatorConfigOf } from '../helpers/ringSystemInternals'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 }) },
    resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
  }) as unknown as Actor

describe('AsteroidRingSystem: объёмность одна на сетку и генератор', () => {
  it('cellHeightKm меньше толщины — volumetric true и у сетки, и у конфига генератора', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { thicknessKm: 400, cellHeightKm: 100 })
    const { sectorGrid, generator } = internalsOf(system)

    expect(sectorGrid.volumetric).toBe(true)
    expect(generatorConfigOf(generator).volumetric).toBe(true)
  })

  it('без cellHeightKm — volumetric false и у сетки, и у конфига генератора', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const { sectorGrid, generator } = internalsOf(system)

    expect(sectorGrid.volumetric).toBe(false)
    expect(generatorConfigOf(generator).volumetric).toBe(false)
  })
})
