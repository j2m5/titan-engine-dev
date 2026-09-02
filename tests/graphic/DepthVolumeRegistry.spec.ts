import { Object3D } from 'three'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import type { DepthVolume } from '@/core/graphic/passes/DepthVolume'

// Реестру нужна только идентичность объёма — материал он не трогает
const fakeVolume = (): DepthVolume => new Object3D() as unknown as DepthVolume

describe('DepthVolumeRegistry', () => {
  it('хранит объёмы по идентичности, повторная регистрация не дублирует', () => {
    const registry = new DepthVolumeRegistry()
    const a = fakeVolume()
    const b = fakeVolume()
    registry.register(a)
    registry.register(b)
    registry.register(a)
    expect(registry.volumes()).toEqual([a, b])
    expect(registry.size).toBe(2)
  })

  it('unregister снимает объём, повторный вызов безвреден', () => {
    const registry = new DepthVolumeRegistry()
    const a = fakeVolume()
    registry.register(a)
    registry.unregister(a)
    registry.unregister(a)
    expect(registry.volumes()).toEqual([])
  })

  it('volumes() отдаёт снимок: мутация результата не трогает реестр', () => {
    const registry = new DepthVolumeRegistry()
    registry.register(fakeVolume())
    const snapshot = registry.volumes() as DepthVolume[]
    snapshot.length = 0
    expect(registry.size).toBe(1)
  })
})
