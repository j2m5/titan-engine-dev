import { vi } from 'vitest'

const fakeTexture = { name: 'any' }
vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => undefined, getTextureOrMake: () => fakeTexture }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { Actor } from '@/core/models/Actor'
import type { InstancedMesh } from 'three'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 }) },
    resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
  }) as unknown as Actor

/* eslint-disable @typescript-eslint/no-explicit-any -- приватные поля в тестах, как в соседних спеках */

describe('AsteroidRingSystem: библиотека архетипов в рендере (K из конфига)', () => {
  it('при дефолте — 2K+1=29 рендер-объектов пула (14 Geometry + 14 Near + 1 billboard)', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const renderObjects = system.children.filter((c) => c.name.startsWith('AsteroidPool_'))

    expect(renderObjects.length).toBe(29)

    const geometryMeshes = renderObjects.filter((c) => c.name.startsWith('AsteroidPool_L0_'))
    const nearMeshes = renderObjects.filter((c) => c.name.startsWith('AsteroidPool_Near_'))
    const billboards = renderObjects.filter((c) => c.name === 'AsteroidPool_L1')
    expect(geometryMeshes.length).toBe(14)
    expect(nearMeshes.length).toBe(14)
    expect(billboards.length).toBe(1)
  })

  it('все Geometry-меши делят один материал, юниформы профиля живут в нём', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const geometryMeshes = (system as any).pool.geometryMeshes as InstancedMesh[]

    const materials = new Set(geometryMeshes.map((m) => m.material))
    expect(materials.size).toBe(1)

    const sharedMaterial = (system as any).pool.geometryMaterial
    expect(geometryMeshes[0].material).toBe(sharedMaterial)
    expect(sharedMaterial.uniforms.uRockColor).toBeDefined()
  })

  it('archetypeCount: 3 в overrides → 2·3+1=7 рендер-объектов пула', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { archetypeCount: 3 })
    const renderObjects = system.children.filter((c) => c.name.startsWith('AsteroidPool_'))

    expect(renderObjects.length).toBe(7)
    expect((system as any).pool.geometryMeshes.length).toBe(3)
    expect((system as any).pool.nearMeshes.length).toBe(3)
  })

  it('геометрии Geometry-мешей попарно различны (первые вершины позиций не совпадают)', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const geometryMeshes = (system as any).pool.geometryMeshes as InstancedMesh[]

    const firstVertices = geometryMeshes.map((m) => {
      const pos = m.geometry.getAttribute('position')
      return [pos.getX(0), pos.getY(0), pos.getZ(0)]
    })

    for (let i = 0; i < firstVertices.length; i++) {
      for (let j = i + 1; j < firstVertices.length; j++) {
        expect(firstVertices[i]).not.toEqual(firstVertices[j])
      }
    }
  })
})
