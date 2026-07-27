import { describe, it, expect, vi } from 'vitest'
import { Group, Scene } from 'three'
import { SceneManager } from '@/core/services/SceneManager'
import type { MarkerManager } from '@/core/services/MarkerManager'
import type { RenderableFactory } from '@/core/renderables/RenderableFactory'
import type { Settings } from '@/core/ports/Settings'

function makeManager(scene: Scene, markerDispose = vi.fn()): SceneManager {
  const markers = { add: vi.fn(), update: vi.fn(), dispose: markerDispose } as unknown as MarkerManager
  const settings = { showOrbitLines: true, showMarkers: true } as unknown as Settings
  const factory = { make: vi.fn() } as unknown as RenderableFactory

  return new SceneManager(markers, settings, scene, factory)
}

describe('SceneManager.dispose', () => {
  it('снимает содержимое сценария со сцены', () => {
    const scene = new Scene()
    const manager = makeManager(scene)
    const root = new Group()
    root.name = 'scenario-root'
    scene.add(root)

    manager.dispose()

    expect(scene.children).toHaveLength(0)
  })

  it('отцепляет прицел, но НЕ освобождает его', () => {
    const scene = new Scene()
    const manager = makeManager(scene)
    const holder = new Group()
    scene.add(holder)
    holder.add(manager.crosshair)

    const before = manager.crosshair

    manager.dispose()

    expect(manager.crosshair).toBe(before)
    expect(manager.crosshair.parent).toBeNull()
  })

  it('передаёт разборку маркеров их менеджеру', () => {
    const scene = new Scene()
    const markerDispose = vi.fn()
    const manager = makeManager(scene, markerDispose)

    manager.dispose()

    expect(markerDispose).toHaveBeenCalledTimes(1)
  })

  it('повторный вызов безвреден', () => {
    const scene = new Scene()
    const manager = makeManager(scene)

    manager.dispose()

    expect(() => manager.dispose()).not.toThrow()
  })
})
