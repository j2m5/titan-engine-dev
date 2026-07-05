import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const cfg = { maxInstances: 10 }

describe('InstancePool: detail геометрии L0', () => {
  it('дефолт detail 1 → 240 позиций (60·(1+1)², non-indexed)', () => {
    const pool = new InstancePool(cfg, cfg, 1)
    expect(pool.geometryMesh.geometry.getAttribute('position').count).toBe(240)
  })

  it('detail 2 → 540 позиций (60·(2+1)²) для неровного силуэта', () => {
    const pool = new InstancePool(cfg, cfg, 1, 2)
    expect(pool.geometryMesh.geometry.getAttribute('position').count).toBe(540)
  })
})
