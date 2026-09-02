import { Object3D } from 'three'
import { RingDustRegistry } from '@/core/services/RingDustRegistry'
import type { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'

// Реестру нужна только идентичность объёма — материал он не трогает
const fakeVolume = (): RingDustVolume => new Object3D() as unknown as RingDustVolume

describe('RingDustRegistry', () => {
  it('хранит объёмы по идентичности, повторная регистрация не дублирует', () => {
    const registry = new RingDustRegistry()
    const a = fakeVolume()
    const b = fakeVolume()
    registry.register(a)
    registry.register(b)
    registry.register(a)
    expect(registry.volumes()).toEqual([a, b])
    expect(registry.size).toBe(2)
  })

  it('unregister снимает объём, повторный вызов безвреден', () => {
    const registry = new RingDustRegistry()
    const a = fakeVolume()
    registry.register(a)
    registry.unregister(a)
    registry.unregister(a)
    expect(registry.volumes()).toEqual([])
  })

  it('volumes() отдаёт снимок: мутация результата не трогает реестр', () => {
    const registry = new RingDustRegistry()
    registry.register(fakeVolume())
    const snapshot = registry.volumes() as RingDustVolume[]
    snapshot.length = 0
    expect(registry.size).toBe(1)
  })
})
