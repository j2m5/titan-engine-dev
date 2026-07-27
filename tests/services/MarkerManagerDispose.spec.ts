import { describe, it, expect, vi } from 'vitest'
import { Group } from 'three'
import { MarkerManager } from '@/core/services/MarkerManager'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { Settings } from '@/core/ports/Settings'
import type { Actor } from '@/core/models/Actor'

describe('MarkerManager.dispose', () => {
  it('снимает маркеры и подписи с их узлов', () => {
    const observer = { subscribe: vi.fn(), getData: vi.fn() } as unknown as SceneObserver
    const settings = { showMarkers: true } as unknown as Settings
    const manager = new MarkerManager(observer, settings)
    const host = new Group()

    manager.add({
      model: { getAttribute: () => 'Тест' } as unknown as Actor,
      object: host,
      shape: 'hex',
      depth: 0
    })

    expect(host.children.length).toBeGreaterThan(0)

    manager.dispose()

    expect(host.children).toHaveLength(0)
  })

  it('повторный вызов безвреден', () => {
    const observer = { subscribe: vi.fn(), getData: vi.fn() } as unknown as SceneObserver
    const settings = { showMarkers: true } as unknown as Settings
    const manager = new MarkerManager(observer, settings)

    manager.dispose()

    expect(() => manager.dispose()).not.toThrow()
  })
})
