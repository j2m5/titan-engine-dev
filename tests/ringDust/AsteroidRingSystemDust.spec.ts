import { vi } from 'vitest'

// resourceStorage тянет текстуры при создании L0-материала — в jsdom их нет
vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { Actor } from '@/core/models/Actor'
import { poolOf } from '../helpers/ringSystemInternals'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 })
    }
  }) as unknown as Actor

describe('AsteroidRingSystem dust integration', () => {
  it('adds a RingDustVolume child by default', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const dust = system.children.find((c) => c.name === 'RingDustVolume')
    expect(dust).toBeDefined()
  })

  it('калибрует плотность через целевой tau грейзинг-луча (dustTauGrazing / ширину кольца)', () => {
    // Явный override: тест проверяет формулу калибровки, а не дефолт
    const system = new AsteroidRingSystem(makeFakeActor(), { dustTauGrazing: 0.3 })
    const u = poolOf(system).billboardMaterial.uniforms
    const width = u.uDustRingOuter.value - u.uDustRingInner.value
    expect(u.uDustDensity.value).toBeCloseTo(0.3 / width, 10)
  })

  it('передаёт гейт и рамп в материалы камней', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = poolOf(system).billboardMaterial.uniforms
    expect(u.uDustAnglePower.value).toBe(2)
    expect(u.uDustNearFade.value).toBeGreaterThan(0)
  })

  it('регистрирует объём пыли в реестре пасса, когда реестр передан', () => {
    const registry = new DepthVolumeRegistry()
    const system = new AsteroidRingSystem(makeFakeActor(), {}, registry)
    const dust = system.children.find((c) => c.name === 'RingDustVolume')
    expect(registry.volumes()).toEqual([dust])
  })

  it('respects dustEnabled: false override', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { dustEnabled: false })
    const dust = system.children.find((c) => c.name === 'RingDustVolume')
    expect(dust).toBeUndefined()
    const uniforms = poolOf(system).billboardMaterial.uniforms
    expect(uniforms.uDustDensity.value).toBe(0)
  })
})
