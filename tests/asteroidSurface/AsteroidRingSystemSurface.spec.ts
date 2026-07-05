import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { Actor } from '@/core/models/Actor'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 })
    }
  }) as unknown as Actor

describe('AsteroidRingSystem: интеграция облика', () => {
  it('дефолтом кладёт параметры облика в L0-материал', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(u.uCraterDepth.value).toBeGreaterThan(0)
    expect(u.uCraterOctaves.value).toBe(1)
    expect(u.uAoStrength.value).toBeGreaterThan(0)
  })

  it('уважает override параметров облика (ручки перфа/визуала)', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { craterOctaves: 2, crackIntensity: 0 })
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(u.uCraterOctaves.value).toBe(2)
    expect(u.uCrackIntensity.value).toBe(0)
  })
})
