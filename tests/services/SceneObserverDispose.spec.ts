import { describe, it, expect, vi } from 'vitest'
import { Object3D, Scene, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { SceneObserver } from '@/core/services/SceneObserver'
import type { AstroControls } from '@/core/libs/AstroControls'

type ChangeListener = (event: { data: Vector3 }) => void

type AstroControlsStub = AstroControls & { dispatch: (data: Vector3) => void }

/**
 * Минимальная заглушка `AstroControls`: только то, что реально трогает
 * `SceneObserver` — `object.position` (настоящий `Vector3`, потому что
 * `makeRecord` вызывает `distanceTo`), `setTarget`, `addEventListener`/
 * `removeEventListener` для события `change`.
 */
function makeAstroControlsStub(): AstroControlsStub {
  const listeners: ChangeListener[] = []

  const stub = {
    object: { position: new Vector3(0, 0, 0) },
    setTarget: vi.fn(),
    addEventListener: vi.fn((event: string, callback: ChangeListener): void => {
      if (event === 'change') listeners.push(callback)
    }),
    removeEventListener: vi.fn((event: string, callback: ChangeListener): void => {
      if (event !== 'change') return

      const index = listeners.indexOf(callback)
      if (index !== -1) listeners.splice(index, 1)
    }),
    dispatch: (data: Vector3): void => {
      listeners.forEach((callback: ChangeListener): void => callback({ data }))
    }
  }

  return stub as unknown as AstroControlsStub
}

function makeSceneWithPlanet(): Scene {
  const scene = new Scene()
  const planet = new Object3D()

  planet.name = 'planet'
  planet.userData.type = 'planet'
  planet.position.set(10, 0, 0)

  scene.add(planet)

  return scene
}

describe('SceneObserver.dispose', () => {
  it('не рвёт собственную подписку синглтона: после dispose() и повторного включения в сценарий data снова наполняется', () => {
    const observer = new SceneObserver()

    const firstControls = makeAstroControlsStub()
    observer.observable = firstControls
    observer.scene = makeSceneWithPlanet()

    firstControls.dispatch(new Vector3(1, 2, 3))

    expect(observer.data.size).toBeGreaterThan(0)

    observer.dispose()

    expect(observer.data.size).toBe(0)

    const secondControls = makeAstroControlsStub()
    observer.observable = secondControls
    observer.scene = makeSceneWithPlanet()

    secondControls.dispatch(new Vector3(4, 5, 6))

    expect(observer.data.size).toBeGreaterThan(0)
  })
})
