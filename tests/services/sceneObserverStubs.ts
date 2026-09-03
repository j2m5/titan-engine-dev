import { vi } from 'vitest'
import { Object3D, Scene, Vector3 } from 'three'
import type { AstroControls } from '@/core/libs/AstroControls'

type ChangeListener = (event: { data: Vector3 }) => void

export type AstroControlsStub = AstroControls & { dispatch: (data: Vector3) => void; isOrbiting: boolean }

/**
 * Минимальная заглушка `AstroControls`: только то, что реально трогает
 * `SceneObserver` — `object.position` (настоящий `Vector3`, потому что
 * `makeRecord` вызывает `distanceTo`), `isOrbiting` (в заглушке — простое
 * поле, тест выставляет его сам), `setTarget`, `addEventListener`/
 * `removeEventListener` для события `change`.
 */
export function makeAstroControlsStub(): AstroControlsStub {
  const listeners: ChangeListener[] = []

  const stub = {
    object: { position: new Vector3(0, 0, 0) },
    isOrbiting: false,
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

/**
 * Сцена с одним телом заданного `userData.type` — тем полем, по которому
 * наблюдатель и ищет.
 *
 * `model` обязателен: имя записи `makeRecord` берёт из него, а не из
 * `Object3D.name`, и без заглушки любое тело зовётся «unknown».
 */
export function makeSceneWithBody(type: string, name: string = type): Scene {
  const scene = new Scene()

  scene.add(makeBody(type, name, new Vector3(10, 0, 0)))

  return scene
}

/** Тело для сцены наблюдателя: тип в `userData`, имя — через заглушку `model`. */
export function makeBody(type: string, name: string, position: Vector3): Object3D {
  const body = new Object3D()

  body.name = name
  body.userData.type = type
  body.position.copy(position)
  body.model = { getAttribute: (key: string, fallback?: unknown): unknown => (key === 'name' ? name : fallback) } as never

  return body
}
