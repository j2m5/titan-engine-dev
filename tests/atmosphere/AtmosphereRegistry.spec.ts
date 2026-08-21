import { Object3D } from 'three'
import { AtmosphereRegistry, AtmosphereEntry } from '@/core/services/AtmosphereRegistry'

function entry(actorId: number): AtmosphereEntry {
  return {
    actorId,
    name: `A${actorId}`,
    object: new Object3D(),
    config: {} as AtmosphereEntry['config'],
    lut: {} as AtmosphereEntry['lut']
  }
}

describe('AtmosphereRegistry', () => {
  it('регистрирует, перечисляет, снимает', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry(1))
    registry.register(entry(2))
    expect(registry.size).toBe(2)
    registry.unregister(1)
    expect(registry.entries().map((e) => e.actorId)).toEqual([2])
  })

  it('повторная регистрация того же actorId заменяет запись, а не дублирует', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry(7))
    const second = entry(7)
    registry.register(second)
    expect(registry.size).toBe(1)
    expect(registry.entries()[0]).toBe(second)
  })

  it('entries() — снимок: мутация снаружи реестр не трогает', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry(1))
    const list = registry.entries() as AtmosphereEntry[]
    list.length = 0
    expect(registry.size).toBe(1)
  })
})
