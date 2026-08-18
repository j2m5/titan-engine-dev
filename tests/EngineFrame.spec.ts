import { describe, it, expect, vi } from 'vitest'
import { Clock, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import type { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Engine } from '@/core/Engine'
import type { SceneManager } from '@/core/services/SceneManager'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { SimulationClock } from '@/core/time/SimulationClock'
import type { CameraController, CameraFollowUpdate } from '@/core/camera/CameraController'
import type { AstroControls } from '@/core/libs/AstroControls'
import type { Postprocessing } from '@/core/graphic/Postprocessing'
import type { CameraCollision } from '@/core/services/CameraCollision'

/**
 * Стенд по образцу `EngineDispose.spec.ts`, но `renderer.domElement`/
 * `labelRenderer.domElement` — настоящие DOM-элементы: `initialize()` делает
 * `document.body.appendChild`, голая заглушка `{ style: {} }` там падает.
 */
function makeEngine() {
  const order: string[] = []
  const canvas = document.createElement('canvas')
  const overlay = document.createElement('div')

  const sceneManager = {
    initialize: vi.fn(),
    update: vi.fn((): void => void order.push('scene')),
    updateMarkers: vi.fn((): void => void order.push('markers')),
    dispose: vi.fn(),
    crosshair: {}
  } as unknown as SceneManager
  const sceneObserver = {
    dispose: vi.fn(),
    tick: vi.fn((): void => void order.push('observer')),
    set observable(_value: AstroControls) {},
    set scene(_value: Scene) {}
  } as unknown as SceneObserver
  const postprocessing = {
    initialize: vi.fn(),
    render: vi.fn((): void => void order.push('render')),
    dispose: vi.fn(),
    setSize: vi.fn()
  } as unknown as Postprocessing
  const renderer = {
    domElement: canvas,
    setAnimationLoop: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn()
  } as unknown as WebGLRenderer
  const cameraController = {
    speed: 1,
    updateFollow: vi.fn(() => {
      order.push('follow')
      return null as CameraFollowUpdate | null
    }),
    stopFollowing: vi.fn()
  }
  const astroControls = {
    update: vi.fn(),
    setTarget: vi.fn(),
    enabled: true,
    movementSpeed: 0
  }
  const cameraCollision = {
    translateReferenceFrame: vi.fn((): void => void order.push('translate')),
    resolve: vi.fn((): void => void order.push('collision')),
    reset: vi.fn()
  }
  const labelRenderer = {
    domElement: overlay,
    render: vi.fn((): void => void order.push('labels')),
    setSize: vi.fn()
  }
  const renderCamera = new PerspectiveCamera()

  const engine = new Engine(
    sceneManager,
    sceneObserver,
    { advance: vi.fn(), epoch: 0 } as unknown as SimulationClock,
    cameraController as unknown as CameraController,
    renderer,
    labelRenderer as unknown as CSS2DRenderer,
    new Scene(),
    renderCamera,
    astroControls as unknown as AstroControls,
    new Clock(),
    postprocessing,
    cameraCollision as unknown as CameraCollision
  )

  return {
    engine,
    sceneObserver,
    sceneManager,
    cameraController,
    astroControls,
    cameraCollision,
    labelRenderer,
    renderCamera,
    order
  }
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

  it('после обновления тел применяет follow-дельту, рендерит CSS2D и затем фильтрует маркеры', () => {
    const {
      engine,
      cameraController,
      astroControls,
      cameraCollision,
      renderCamera,
      order
    } = makeEngine()
    const displacement = new Vector3(4, 5, 6)
    const targetPosition = new Vector3(10, 20, 30)

    cameraController.updateFollow.mockImplementation(() => {
      order.push('follow')
      renderCamera.position.add(displacement)
      return { displacement, targetPosition }
    })

    engine.start()

    expect(astroControls.setTarget).toHaveBeenCalledWith(targetPosition)
    expect(cameraCollision.translateReferenceFrame).toHaveBeenCalledWith(displacement)
    expect(order).toEqual([
      'scene',
      'observer',
      'follow',
      'translate',
      'collision',
      'labels',
      'markers',
      'render'
    ])
  })
})
