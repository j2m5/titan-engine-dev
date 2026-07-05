import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const cfg = { maxInstances: 10 }

describe('InstancePool: detail геометрии L0', () => {
  it('дефолт detail 1 → 240 позиций (20·4·3, non-indexed)', () => {
    const pool = new InstancePool(cfg, cfg, 1)
    expect(pool.geometryMesh.geometry.getAttribute('position').count).toBe(240)
  })

  it('detail 2 → 960 позиций (20·16·3) для неровного силуэта', () => {
    const pool = new InstancePool(cfg, cfg, 1, 2)
    expect(pool.geometryMesh.geometry.getAttribute('position').count).toBe(960)
  })
})
