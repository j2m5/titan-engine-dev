import { describe, it, expect, vi } from 'vitest'
import { BoxGeometry, Clock, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { WebGLRenderLists } from 'three/src/renderers/webgl/WebGLRenderLists'
import { WebGLProperties } from 'three/src/renderers/webgl/WebGLProperties'
import type { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Engine } from '@/core/Engine'
import type { SceneManager } from '@/core/services/SceneManager'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { SimulationClock } from '@/core/time/SimulationClock'
import type { CameraController } from '@/core/camera/CameraController'
import type { AstroControls } from '@/core/libs/AstroControls'
import type { Postprocessing } from '@/core/graphic/Postprocessing'
import type { CameraCollision } from '@/core/services/CameraCollision'

function makeEngine() {
  const order: string[] = []
  const domElement = { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const scene = new Scene()

  const sceneManager = {
    initialize: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(() => { scene.clear(); order.push('scene') }),
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
    renderLists: new WebGLRenderLists(new WebGLProperties()),
    setAnimationLoop: vi.fn(() => order.push('loop')),
    setSize: vi.fn()
  } as unknown as WebGLRenderer
  const cameraController = {
    speed: 1,
    stopFollowing: vi.fn(() => order.push('follow'))
  }

  const engine = new Engine(
    sceneManager,
    sceneObserver,
    { advance: vi.fn(), epoch: 0 } as unknown as SimulationClock,
    cameraController as unknown as CameraController,
    renderer,
    { domElement: { ...domElement }, render: vi.fn() } as unknown as CSS2DRenderer,
    scene,
    new PerspectiveCamera(),
    { update: vi.fn(), enabled: true } as unknown as AstroControls,
    new Clock(),
    postprocessing,
    { resolve: vi.fn(), reset: vi.fn() } as unknown as CameraCollision
  )

  return { engine, order, sceneManager, sceneObserver, postprocessing, domElement, cameraController, renderer, scene }
}

describe('Engine.dispose', () => {
  it('releases the last rendered objects at every render depth and allows later scenarios to render', () => {
    const { engine, renderer, scene } = makeEngine()

    for (let scenario = 0; scenario < 2; scenario++) {
      const geometry = new BoxGeometry()
      const materials = [new MeshBasicMaterial(), new MeshBasicMaterial({ transparent: true }), new MeshPhysicalMaterial({ transmission: 1 })]
      const meshes = materials.map(material => new Mesh(geometry, material))
      scene.add(...meshes)

      for (const depth of [0, 1]) {
        const list = renderer.renderLists.get(scene, depth)
        list.init()
        for (const mesh of meshes) list.push(mesh, geometry, mesh.material, 0, 0, null)
        list.finish()
        expect(list.opaque[0].object).toBe(meshes[0])
        expect(list.transparent[0].object).toBe(meshes[1])
        expect(list.transmissive[0].object).toBe(meshes[2])
      }

      engine.dispose()

      expect(scene.children).toHaveLength(0)
      for (const depth of [0, 1]) {
        const list = renderer.renderLists.get(scene, depth)
        expect(list.opaque).toHaveLength(0)
        expect(list.transparent).toHaveLength(0)
        expect(list.transmissive).toHaveLength(0)
      }
      geometry.dispose()
      materials.forEach(material => material.dispose())
    }
  })

  it('делегирует разборку своим сотрудникам', () => {
    const { engine, sceneManager, sceneObserver, postprocessing, cameraController } = makeEngine()

    engine.dispose()

    expect(cameraController.stopFollowing).toHaveBeenCalledTimes(1)
    expect(sceneManager.dispose).toHaveBeenCalledTimes(1)
    expect(postprocessing.dispose).toHaveBeenCalledTimes(1)
    expect(sceneObserver.dispose).toHaveBeenCalledTimes(1)
  })

  it('останавливает луп последним: сначала уходим из сцены, потом перестаём рисовать', () => {
    const { engine, order } = makeEngine()

    engine.dispose()

    expect(order.indexOf('loop')).toBe(order.length - 1)
  })

  it('снимает только слушатель wheel сценария, но не click конструктора-синглтона', () => {
    // Владелец постановил: resize и click живут весь срок жизни Engine
    // (регистрируются в конструкторе), их снятие здесь навсегда сломало бы
    // клик-по-объекту-в-прицел после первого teardown. Снимается только
    // wheel — он регистрируется в onStart() и принадлежит сценарию.
    const { engine, domElement } = makeEngine()

    engine.dispose()

    expect(domElement.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function))
    expect(domElement.removeEventListener).not.toHaveBeenCalledWith('click', expect.any(Function))
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
