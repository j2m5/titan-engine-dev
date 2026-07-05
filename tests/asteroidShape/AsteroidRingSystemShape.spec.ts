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

describe('AsteroidRingSystem: интеграция формы', () => {
  it('дефолтом ставит detail 2 на L0-геометрию (540 позиций)', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const geom = (system as any).pool.geometryMesh.geometry
    expect(geom.getAttribute('position').count).toBe(540)
  })

  it('дефолтом кладёт положительные амплитуду/частоту в L0-материал', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(u.uShapeAmp.value).toBeGreaterThan(0)
    expect(u.uShapeFreq.value).toBeGreaterThan(0)
  })

  it('уважает override detail и амплитуды (ручки FPS/визуала)', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { asteroidShapeDetail: 1, shapeAmp: 0 })
    const geom = (system as any).pool.geometryMesh.geometry
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(geom.getAttribute('position').count).toBe(240)
    expect(u.uShapeAmp.value).toBe(0)
  })
})
