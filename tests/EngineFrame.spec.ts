import { describe, it, expect, vi } from 'vitest'
import { Clock, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import type { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Engine } from '@/core/Engine'
import type { SceneManager } from '@/core/services/SceneManager'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { SimulationClock } from '@/core/time/SimulationClock'
import type { CameraController } from '@/core/camera/CameraController'
import type { AstroControls } from '@/core/libs/AstroControls'
import type { Postprocessing } from '@/core/graphic/Postprocessing'
import type { CameraCollision } from '@/core/services/CameraCollision'

/**
 * Стенд по образцу `EngineDispose.spec.ts`, но `renderer.domElement`/
 * `labelRenderer.domElement` — настоящие DOM-элементы: `initialize()` делает
 * `document.body.appendChild`, голая заглушка `{ style: {} }` там падает.
 */
function makeEngine() {
  const canvas = document.createElement('canvas')
  const overlay = document.createElement('div')

  const sceneManager = {
    initialize: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
    crosshair: {}
  } as unknown as SceneManager
  const sceneObserver = {
    dispose: vi.fn(),
    tick: vi.fn(),
    set observable(_value: AstroControls) {},
    set scene(_value: Scene) {}
  } as unknown as SceneObserver
  const postprocessing = {
    initialize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    setSize: vi.fn()
  } as unknown as Postprocessing
  const renderer = {
    domElement: canvas,
    setAnimationLoop: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn()
  } as unknown as WebGLRenderer

  const engine = new Engine(
    sceneManager,
    sceneObserver,
    { advance: vi.fn(), epoch: 0 } as unknown as SimulationClock,
    { speed: 1 } as unknown as CameraController,
    renderer,
    { domElement: overlay, render: vi.fn(), setSize: vi.fn() } as unknown as CSS2DRenderer,
    new Scene(),
    new PerspectiveCamera(),
    { update: vi.fn(), enabled: true, movementSpeed: 0 } as unknown as AstroControls,
    new Clock(),
    postprocessing,
    { resolve: vi.fn(), reset: vi.fn() } as unknown as CameraCollision
  )

  return { engine, sceneObserver }
}

describe('Engine: подключение периодического пересчёта к кадровому циклу', () => {
  it('start() зовёт sceneObserver.tick — единственная нить между частью 2 и работающим приложением', () => {
    // Спека части 2 требовала этот тест, план его отменил на неверной
    // посылке: `Engine.onFrameRendered` зовёт `sceneObserver.tick(delta)`, но
    // без этого теста удаление строки не роняет ни один существующий тест —
    // фича периодического пересчёта тихо исчезает, а комментарий-обоснование
    // в SceneObserver.tick остаётся жить рядом с мёртвым вызовом.
    const { engine, sceneObserver } = makeEngine()

    engine.start()

    expect(sceneObserver.tick).toHaveBeenCalledTimes(1)
  })
})
