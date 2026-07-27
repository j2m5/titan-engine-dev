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

function makeEngine() {
  const order: string[] = []
  const domElement = { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() }

  const sceneManager = {
    initialize: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(() => order.push('scene')),
    crosshair: {}
  } as unknown as SceneManager
  const sceneObserver = { dispose: vi.fn(() => order.push('observer')) } as unknown as SceneObserver
  const postprocessing = {
    initialize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(() => order.push('post'))
  } as unknown as Postprocessing
  const renderer = {
    domElement,
    setAnimationLoop: vi.fn(() => order.push('loop')),
    setSize: vi.fn()
  } as unknown as WebGLRenderer

  const engine = new Engine(
    sceneManager,
    sceneObserver,
    { advance: vi.fn(), epoch: 0 } as unknown as SimulationClock,
    { speed: 1 } as unknown as CameraController,
    renderer,
    { domElement: { ...domElement }, render: vi.fn() } as unknown as CSS2DRenderer,
    new Scene(),
    new PerspectiveCamera(),
    { update: vi.fn(), enabled: true } as unknown as AstroControls,
    new Clock(),
    postprocessing
  )

  return { engine, order, sceneManager, sceneObserver, postprocessing }
}

describe('Engine.dispose', () => {
  it('делегирует разборку своим сотрудникам', () => {
    const { engine, sceneManager, sceneObserver, postprocessing } = makeEngine()

    engine.dispose()

    expect(sceneManager.dispose).toHaveBeenCalledTimes(1)
    expect(postprocessing.dispose).toHaveBeenCalledTimes(1)
    expect(sceneObserver.dispose).toHaveBeenCalledTimes(1)
  })

  it('останавливает луп последним: сначала уходим из сцены, потом перестаём рисовать', () => {
    const { engine, order } = makeEngine()

    engine.dispose()

    expect(order.indexOf('loop')).toBe(order.length - 1)
  })

  it('работает на остановленном движке', () => {
    // Раньше метод начинался с `if (!this.running) return`, из-за чего выход
    // домой с последующим входом оставлял предыдущую сцену в графе.
    const { engine, sceneManager } = makeEngine()

    engine.dispose()
    engine.dispose()

    expect(sceneManager.dispose).toHaveBeenCalledTimes(2)
  })
})
