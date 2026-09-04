import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { getArchetypeGeometries } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary'
import { Actor } from '@/core/models/Actor'
import { poolOf } from '../helpers/ringSystemInternals'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 }) }
  }) as unknown as Actor

describe('Тесселяция ближнего тира', () => {
  it('икосфера three: detail d → 20·(d+1)² треугольников (320 для L0 detail 3, 1280 для Near detail 7)', () => {
    const l0 = getArchetypeGeometries('stony', 1, 3, 1)[0]
    const near = getArchetypeGeometries('stony', 1, 7, 1)[0]
    const triangles = (g: typeof l0) => (g.getIndex() ? g.getIndex()!.count : g.getAttribute('position').count) / 3
    expect(triangles(l0)).toBe(320)
    expect(triangles(near)).toBe(1280)
  })

  it('дефолт системы: Near в 4 раза плотнее L0 — контур вблизи не полигональный рядом с реальными моделями', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { archetypeCount: 2 })
    const pool = poolOf(system)
    const tris = (k: number, near: boolean) => {
      const g = (near ? pool.nearMeshes : pool.geometryMeshes)[k].geometry
      return (g.getIndex() ? g.getIndex()!.count : g.getAttribute('position').count) / 3
    }
    expect(tris(0, false)).toBe(320)
    expect(tris(0, true)).toBe(1280)
  })
})
