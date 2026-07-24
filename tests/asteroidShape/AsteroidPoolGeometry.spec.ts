import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { IcosahedronGeometry } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const cfg = { maxInstances: 10 }

describe('InstancePool: переданная геометрия L0', () => {
  it('geometryMesh.geometry — тот же объект, что передан в конструктор', () => {
    const l0Geometry = new IcosahedronGeometry(1, 2)
    const pool = new InstancePool(cfg, cfg, l0Geometry, 2.5)
    expect(pool.geometryMesh.geometry).toBe(l0Geometry)
  })

  it('на переданную геометрию добавлен instanceFade нужной длины (maxInstances)', () => {
    const l0Geometry = new IcosahedronGeometry(1, 2)
    const pool = new InstancePool(cfg, cfg, l0Geometry, 2.5)
    const attr = pool.geometryMesh.geometry.getAttribute('instanceFade')
    expect(attr).toBeDefined()
    expect(attr.count).toBe(cfg.maxInstances)
  })
})
