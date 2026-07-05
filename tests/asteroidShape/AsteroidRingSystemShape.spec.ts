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

  it('дефолтом кладёт диапазон амплитуды и частоту в L0-материал', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(u.uShapeAmpMin.value).toBeCloseTo(0.3, 10)
    expect(u.uShapeAmpMax.value).toBeCloseTo(0.8, 10)
    expect(u.uShapeFreq.value).toBeCloseTo(1.4, 10)
  })

  it('уважает override detail и диапазона амплитуды (ручки FPS/визуала)', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), {
      asteroidShapeDetail: 1,
      shapeAmpMin: 0,
      shapeAmpMax: 0
    })
    const geom = (system as any).pool.geometryMesh.geometry
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(geom.getAttribute('position').count).toBe(240)
    expect(u.uShapeAmpMin.value).toBe(0)
    expect(u.uShapeAmpMax.value).toBe(0)
  })
})
