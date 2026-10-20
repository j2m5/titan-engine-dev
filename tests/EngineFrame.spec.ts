import { describe, it, expect, vi } from 'vitest'
import '@/core/framework/TitanThree'
import { Clock, Color, Group, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three'
import type { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Engine } from '@/core/Engine'
import { SceneManager } from '@/core/services/SceneManager'
import type { SceneObserver } from '@/core/services/SceneObserver'
import { SimulationClock } from '@/core/time/SimulationClock'
import type { CameraController, CameraFollowUpdate } from '@/core/camera/CameraController'
import type { AstroControls } from '@/core/libs/AstroControls'
import type { Postprocessing } from '@/core/graphic/Postprocessing'
import type { CameraCollision } from '@/core/services/CameraCollision'
import type { MarkerManager } from '@/core/services/MarkerManager'
import type { Settings } from '@/core/ports/Settings'
import type { RenderableFactory } from '@/core/renderables/RenderableFactory'
import type { Actor } from '@/core/models/Actor'
import { StarLod } from '@/core/renderables/utils/StarLod'
import { Star } from '@/core/renderables/Star'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { DAY } from '@/core/constants'
import { Nebula } from '@/core/renderables/Nebula'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { NebulaBakeQueue } from '@/core/renderables/Nebula/volume/NebulaBakeQueue'

/**
 * Стенд по образцу `EngineDispose.spec.ts`, но `renderer.domElement`/
 * `labelRenderer.domElement` — настоящие DOM-элементы: `initialize()` делает
 * `document.body.appendChild`, голая заглушка `{ style: {} }` там падает.
 */
function makeEngine(scene = new Scene(), manager?: SceneManager, queue?: NebulaBakeQueue) {
  const order: string[] = []
  const canvas = document.createElement('canvas')
  const overlay = document.createElement('div')

  const sceneManager = {
    initialize: vi.fn(),
    update: vi.fn((): void => void order.push('scene')),
    updateView: vi.fn((): void => void order.push('view')),
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
  const surface = { center: new Vector3(), altitude: 1, surfaceRadius: 2 }
  const astroControls = {
    update: vi.fn(),
    setTarget: vi.fn(),
    setSurface: vi.fn((): void => void order.push('surface')),
    enabled: true,
    movementSpeed: 0
  }
  const cameraCollision = {
    translateReferenceFrame: vi.fn((): void => void order.push('translate')),
    resolve: vi.fn((): void => void order.push('collision')),
    nearestSurface: vi.fn(() => surface),
    reset: vi.fn()
  }
  const labelRenderer = {
    domElement: overlay,
    render: vi.fn((): void => void order.push('labels')),
    setSize: vi.fn()
  }
  const renderCamera = new PerspectiveCamera()
  const simulationClock = new SimulationClock(0)
  const renderClock = new Clock()
  const impostors = { pumpFrame: vi.fn((): void => void order.push('impostors')) }
  const nebulaBakes = { pumpFrame: vi.fn(() => { order.push('nebulaBakes'); queue?.pumpFrame() }) }

  const engine = new Engine(
    manager ?? sceneManager,
    sceneObserver,
    simulationClock,
    cameraController as unknown as CameraController,
    renderer,
    labelRenderer as unknown as CSS2DRenderer,
    scene,
    renderCamera,
    astroControls as unknown as AstroControls,
    renderClock,
    postprocessing,
    cameraCollision as unknown as CameraCollision,
    impostors,
    nebulaBakes
  )

  return {
    engine,
    renderer,
    postprocessing,
    sceneObserver,
    sceneManager,
    cameraController,
    astroControls,
    cameraCollision,
    labelRenderer,
    renderCamera,
    simulationClock,
    renderClock,
    impostors,
    nebulaBakes,
    surface,
    order
  }
}

describe('Engine: время кадра', () => {
  it('freezes simulation and active elapsed across a stopped interval', () => {
    let nowMs = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    const { engine, renderer, labelRenderer, sceneManager, simulationClock, renderClock } = makeEngine()

    try {
      engine.start()
      nowMs = 16
      engine.update()
      engine.start()
      nowMs = 100
      const epochBeforePause = simulationClock.epoch
      engine.stop()
      engine.stop()

      nowMs = 60_016
      engine.start()
      const resumedEpoch = simulationClock.epoch
      nowMs = 60_032
      engine.update()
      engine.stop()
      engine.dispose()
      const epochBeforeReinitialize = simulationClock.epoch
      nowMs = 120_032
      engine.start()
      const reinitializedEpoch = simulationClock.epoch
      nowMs = 120_048
      engine.update()

      const contexts = vi.mocked(sceneManager.update).mock.calls.map(([ctx]) => ctx)
      expect(resumedEpoch).toBe(epochBeforePause)
      expect(reinitializedEpoch).toBe(epochBeforeReinitialize)
      expect(contexts.map((ctx) => ctx.delta)).toEqual([0, 0.016, 0, 0.016, 0, 0.016])
      expect(contexts.map((ctx) => ctx.elapsed)).toEqual([0, 0.016, 0.016, 0.032, 0.032, 0.048])
      expect(renderClock.elapsedTime).toBeCloseTo(0.048, 12)
    } finally {
      engine.dispose()
      renderer.domElement.remove()
      labelRenderer.domElement.remove()
      now.mockRestore()
    }
  })

  it.each([0, 4, 12])('учитывает всё время между кадрами при работе контролов %s мс', (workMs) => {
    let nowMs = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    const { engine, renderer, labelRenderer, sceneManager, simulationClock, renderClock, astroControls } = makeEngine()

    astroControls.update.mockImplementation(() => {
      nowMs += workMs
    })

    try {
      renderClock.start()
      nowMs = 16
      engine.start()
      nowMs = 32
      engine.update()
      nowMs = 48
      engine.update()

      const contexts = vi.mocked(sceneManager.update).mock.calls.map(([ctx]) => ctx)
      expect(contexts.map((ctx) => ctx.delta)).toEqual([0, 0.016, 0.016])
      expect(contexts.map((ctx) => ctx.elapsed)).toEqual([0, 0.016, 0.032])
      expect(simulationClock.epoch * DAY).toBeCloseTo(0.032, 12)
    } finally {
      engine.dispose()
      renderer.domElement.remove()
      labelRenderer.domElement.remove()
      now.mockRestore()
    }
  })
})

describe('Engine: подключение периодического пересчёта к кадровому циклу', () => {
  it('pumps the shared nebula queue once after view selection and before rendering', () => {
    const { engine, nebulaBakes, order } = makeEngine()
    try {
      engine.start()
      expect(nebulaBakes.pumpFrame).toHaveBeenCalledOnce()
      expect(order.indexOf('view')).toBeLessThan(order.indexOf('nebulaBakes'))
      expect(order.indexOf('nebulaBakes')).toBeLessThan(order.indexOf('render'))
    } finally { engine.dispose() }
  })
  it('выполняет один шаг импосторов после маркеров перед рендером', () => {
    const { engine, impostors, order } = makeEngine()
    engine.start()
    expect(impostors.pumpFrame).toHaveBeenCalledTimes(1)
    expect(order.indexOf('markers')).toBeLessThan(order.indexOf('impostors'))
    expect(order.indexOf('impostors')).toBeLessThan(order.indexOf('render'))
  })
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
      'surface',
      'view',
      'labels',
      'markers',
      'impostors',
      'nebulaBakes',
      'render'
    ])
  })

  it('поверхность под камерой после коллизии уходит в контролы — от неё чувствительность и осмотр на месте', () => {
    const { engine, astroControls, surface } = makeEngine()

    engine.start()

    expect(astroControls.setSurface).toHaveBeenCalledWith(surface)
  })
})

describe('Engine: Nebula uses the final camera in the current frame', () => {
  it.each([true, false])('selects the final LOD after follow and collision (ending near: %s)', (endingNear) => {
    const scene = new Scene()
    const manager = new SceneManager(
      { update() {} } as unknown as MarkerManager,
      { showOrbitLines: false } as Settings,
      scene,
      { eclipses: { update() {} } } as unknown as RenderableFactory
    )
    const queue = new NebulaBakeQueue({ maxCpuMs: Infinity })
    const frame = makeEngine(scene, manager, queue)
    const camera = frame.renderCamera
    camera.fov = 50
    camera.aspect = 16 / 9
    camera.updateProjectionMatrix()
    camera.position.set(0, 0, endingNear ? 1e6 : 800)
    camera.updateMatrixWorld()
    const bakeDirections: Vector3[] = []
    const matricesAtBake: Vector3[] = []
    const renderer = {
      getSize: (v: Vector2) => v.set(1920, 1080),
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      setRenderTarget() {},
      getClearAlpha: () => 1,
      getClearColor: (color: Color) => color.set(0),
      setClearColor() {},
      clear() {},
      render: (_volume: NebulaVolume, bakeCamera: PerspectiveCamera) => {
        bakeDirections.push(bakeCamera.position.clone().normalize())
        matricesAtBake.push(new Vector3().setFromMatrixPosition(camera.matrixWorld))
      }
    } as unknown as WebGLRenderer
    const nebula = new Nebula(renderer, { size: 500, quality: { bake3DTexture: false } }, null, queue)
    scene.add(nebula)
    const volume = nebula.children.find((child) => child instanceof NebulaVolume)!
    frame.cameraController.updateFollow.mockImplementation(() => {
      // Collision must cross the threshold after follow, before view selection.
      camera.position.set(0, 0, endingNear ? 5e5 : 500)
      return null
    })
    frame.cameraCollision.resolve.mockImplementation(() => {
      camera.position.set(endingNear ? 0 : 1e6, 0, endingNear ? 800 : 0)
      camera.rotation.set(0, endingNear ? 0 : Math.PI / 2, 0)
    })

    try {
      frame.engine.start()

      expect(volume.visible).toBe(true)
      // A partial far image must not replace the live fallback.
      expect(volume.material.uniforms.uLodBlend.value).toBe(1)
      expect(bakeDirections).toHaveLength(endingNear ? 0 : 4)
      if (!endingNear) {
        expect(bakeDirections[0].distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-10)
        expect(matricesAtBake[0].distanceTo(camera.position)).toBeLessThan(1e-10)
      }
      expect(frame.postprocessing.render).toHaveBeenCalledOnce()
      for (let i = 0; i < 3; i++) frame.engine.update()
      expect(volume.material.uniforms.uLodBlend.value).toBe(endingNear ? 1 : 0)
    } finally {
      nebula.dispose()
    }
  })
})

describe('Engine: звезда использует окончательную камеру текущего кадра', () => {
  function makeStarFrame(pixels: number) {
    const scene = new Scene()
    const manager = new SceneManager(
      { update() {} } as unknown as MarkerManager,
      { showOrbitLines: false } as Settings,
      scene,
      { eclipses: { update() {} } } as unknown as RenderableFactory
    )
    const frame = makeEngine(scene, manager)
    frame.renderer.domElement.height = 256
    frame.renderCamera.fov = 50
    frame.renderCamera.aspect = 1
    frame.renderCamera.updateProjectionMatrix()
    const radiusKm = 696000
    const actor = {
      getAttribute: (_key: string, fallback?: unknown): unknown => fallback,
      physicalObject: {
        getAttribute: (key: string, fallback?: unknown): unknown => key === 'radius' ? radiusKm : fallback
      }
    } as unknown as Actor
    const node = new Group()
    const lod = new StarLod(radiusKm, frame.renderer)
    const disk = new Star(actor, lod.glowGain)
    const impostor = new FakeStar(actor, frame.renderer, lod.glowGain)
    lod.addLevel(disk)
    lod.addLevel(impostor, lod.switchDistance(50), 0.05)
    node.add(lod)
    scene.add(node)
    const distance = toThreeJSUnits(radiusKm) * 256 / (pixels * Math.tan(25 * Math.PI / 180))
    frame.renderCamera.position.set(0, 0, distance)

    // CSS2DRenderer в приложении обновляет матрицы до WebGL-рендера.
    frame.labelRenderer.render.mockImplementation(() => {
      scene.updateMatrixWorld()
      frame.renderCamera.updateMatrixWorld()
    })
    const projectedWidth = (): number => {
      const left = new Vector3(-0.5, 0, 0).applyMatrix4(impostor.matrixWorld).project(frame.renderCamera)
      const right = new Vector3(0.5, 0, 0).applyMatrix4(impostor.matrixWorld).project(frame.renderCamera)
      return Math.hypot(left.x - right.x, left.y - right.y) * frame.renderer.domElement.height / 2
    }
    const dispose = (): void => {
      disk.geometry.dispose()
      disk.material.dispose()
      impostor.geometry.dispose()
      impostor.material.dispose()
    }
    return { ...frame, scene, node, lod, disk, impostor, distance, projectedWidth, dispose }
  }

  it.each([5, 80])('перенос звезды вместе с follow-камерой сохраняет размер и яркость (%s px)', (pixels) => {
    const frame = makeStarFrame(pixels)
    const { node, lod, disk, impostor, cameraController, renderCamera, distance } = frame
    node.position.x = distance * 10
    cameraController.updateFollow.mockImplementation(() => {
      renderCamera.position.x = node.position.x
      return { displacement: new Vector3(node.position.x, 0, 0), targetPosition: node.position.clone() }
    })
    try {
      frame.engine.start()
      expect.soft(frame.projectedWidth()).toBeCloseTo(12, 6)
      expect.soft(impostor.getWorldDirection(new Vector3()).dot(new Vector3(0, 0, 1))).toBeCloseTo(1, 10)
      expect.soft(lod.glowGain.value).toBe(pixels === 5 ? 3 : 1)
      expect(disk.material.uniforms.uGlowGain.value).toBe(lod.glowGain.value)
      expect(impostor.material.uniforms.uGlowGain.value).toBe(lod.glowGain.value)
    } finally {
      frame.dispose()
    }
  })

  it('коллизия и смена FOV/разрешения учитываются до рендера, включая скрытый импостор', () => {
    const frame = makeStarFrame(5)
    frame.impostor.visible = false
    frame.cameraCollision.resolve.mockImplementation(() => {
      frame.renderCamera.position.z = frame.distance / 20
      frame.renderCamera.fov = 80
      frame.renderCamera.updateProjectionMatrix()
      frame.renderer.domElement.height = 512
    })
    try {
      frame.engine.start()
      expect(frame.projectedWidth()).toBeCloseTo(12, 6)
      expect(frame.lod.glowGain.value).toBe(1)
      // Физический диск на пороге LOD должен занимать те же 12 пикселей.
      const diameter = 2 * frame.disk.geometry.boundingSphere!.radius * frame.disk.scale.x
      const projectedDiameter = diameter * 512 / (2 * frame.lod.levels[1].distance * Math.tan(40 * Math.PI / 180))
      expect(projectedDiameter).toBeCloseTo(12, 6)
    } finally {
      frame.dispose()
    }
  })
})

describe('Engine: сбой кадра не останавливает цикл', () => {
  it('исключение посреди кадра не выходит в цикл three, следующий кадр запрошен и рисуется', () => {
    const { engine, renderer, sceneManager, postprocessing } = makeEngine()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.mocked(sceneManager.update).mockImplementationOnce(() => {
      throw new Error('onClosestChange')
    })

    expect(() => engine.start()).not.toThrow()
    expect(postprocessing.render).not.toHaveBeenCalled()

    const frame = vi.mocked(renderer.setAnimationLoop).mock.calls.at(-1)![0] as () => void

    expect(frame).toBeTypeOf('function')

    frame()

    expect(postprocessing.render).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it('постоянный сбой пишет в консоль один раз, а не каждый кадр', () => {
    const { engine, renderer, sceneManager } = makeEngine()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.mocked(sceneManager.update).mockImplementation(() => {
      throw new Error('всегда')
    })

    engine.start()

    const frame = vi.mocked(renderer.setAnimationLoop).mock.calls.at(-1)![0] as () => void

    frame()
    frame()

    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })
})
