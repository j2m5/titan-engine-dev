import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { IcosahedronGeometry } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const cfg = { maxInstances: 10 }

describe('InstancePool: переданная геометрия L0 (массив геометрий, K=1)', () => {
  it('geometryMeshes[0].geometry — тот же объект, что передан в конструкторе', () => {
    const l0Geometry = new IcosahedronGeometry(1, 2)
    const pool = new InstancePool(cfg, cfg, [l0Geometry], 2.5)
    expect(pool.geometryMeshes[0].geometry).toBe(l0Geometry)
  })

  it('на переданную геометрию добавлен instanceFade ёмкости стрима (ceil(maxInstances/K·1.5), K=1)', () => {
    const l0Geometry = new IcosahedronGeometry(1, 2)
    const pool = new InstancePool(cfg, cfg, [l0Geometry], 2.5)
    const attr = pool.geometryMeshes[0].geometry.getAttribute('instanceFade')
    expect(attr).toBeDefined()
    expect(attr.count).toBe(Math.ceil(cfg.maxInstances * 1.5))
  })
})
