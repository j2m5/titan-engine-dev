import { Object3D } from 'three'
import { AtmosphereRegistry, AtmosphereEntry } from '@/core/services/AtmosphereRegistry'

function entry(actorId: number): AtmosphereEntry {
  return {
    actorId,
    generation: 0,
    ready: true,
    name: `A${actorId}`,
    object: new Object3D(),
    config: {} as AtmosphereEntry['config'],
    lut: {} as AtmosphereEntry['lut']
  }
}

describe('AtmosphereRegistry', () => {
  it('invalidates generation on pending, readiness and same-actor replacement', () => {
    const registry = new AtmosphereRegistry()
    const first = entry(7)
    registry.register(first)
    const initial = first.generation
    expect(initial).toBeGreaterThan(0)
    registry.markPending(7)
    expect(first.ready).toBe(false)
    expect(first.generation).toBeGreaterThan(initial)
    const pending = first.generation
    registry.markReady(7)
    expect(first.ready).toBe(true)
    expect(first.generation).toBeGreaterThan(pending)
    const ready = first.generation
    registry.register(entry(7))
    expect(registry.get(7)!.generation).toBeGreaterThan(ready)
    registry.unregister(7)
    registry.markReady(7)
    expect(registry.get(7)).toBeUndefined()
    registry.register(entry(8))
    expect(registry.get(8)!.generation).toBeGreaterThan(ready)
  })
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

  it('get(actorId) возвращает запись или undefined', () => {
    const registry = new AtmosphereRegistry()
    const e = entry(5)
    registry.register(e)
    expect(registry.get(5)).toBe(e)
    expect(registry.get(6)).toBeUndefined()
  })

  it('entries() — снимок: мутация снаружи реестр не трогает', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry(1))
    const list = registry.entries() as AtmosphereEntry[]
    list.length = 0
    expect(registry.size).toBe(1)
  })
})
