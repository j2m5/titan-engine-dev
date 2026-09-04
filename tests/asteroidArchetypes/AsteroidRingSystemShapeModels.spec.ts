import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { archetypeLayout } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary'
import type { ShapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
import type { ShapeModelData } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'
import { Actor } from '@/core/models/Actor'
import { poolOf } from '../helpers/ringSystemInternals'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 }) }
  }) as unknown as Actor

const triangle = (): ShapeModelData => ({
  positions: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2])
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('AsteroidRingSystem: реальные модели форм подменяют заглушки хвоста библиотеки', () => {
  it('по приходу обоих ярусов геометрия L0- и Near-стрима слота подменена, голова не тронута', async () => {
    const load = vi.fn(async (): Promise<ShapeModelData | null> => triangle())
    const storage = { load } as unknown as ShapeModelStorage
    const system = new AsteroidRingSystem(makeFakeActor(), { archetypeCount: 4 }, null, storage)
    const layout = archetypeLayout('stony', 4)
    expect(layout.realModels.length).toBeGreaterThan(0)
    const pool = poolOf(system)
    const headCount = pool.geometryMeshes[0].geometry.getAttribute('position').count

    await flush()

    for (let i = 0; i < layout.realModels.length; i++) {
      const k = layout.proceduralCount + i
      expect(pool.geometryMeshes[k].geometry.getAttribute('position').count).toBe(3)
      expect(pool.nearMeshes[k].geometry.getAttribute('position').count).toBe(3)
      expect(pool.geometryMeshes[k].geometry.getAttribute('instanceFade')).toBeDefined()
    }
    expect(pool.geometryMeshes[0].geometry.getAttribute('position').count).toBe(headCount)
    // Оба яруса каждой модели запрошены по имени из профиля
    expect(load).toHaveBeenCalledWith(layout.realModels[0], 'l0')
    expect(load).toHaveBeenCalledWith(layout.realModels[0], 'near')
  })

  it('сбой загрузки яруса оставляет процедурную заглушку', async () => {
    const load = vi.fn(async (_name: string, tier: string): Promise<ShapeModelData | null> =>
      tier === 'near' ? null : triangle()
    )
    const storage = { load } as unknown as ShapeModelStorage
    const system = new AsteroidRingSystem(makeFakeActor(), { archetypeCount: 4 }, null, storage)
    const pool = poolOf(system)
    const k = archetypeLayout('stony', 4).proceduralCount
    const before = pool.geometryMeshes[k].geometry.getAttribute('position').count

    await flush()

    expect(pool.geometryMeshes[k].geometry.getAttribute('position').count).toBe(before)
  })

  it('без хранилища ничего не запрашивается', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { archetypeCount: 4 })
    expect(poolOf(system).geometryMeshes.length).toBe(4)
  })
})
