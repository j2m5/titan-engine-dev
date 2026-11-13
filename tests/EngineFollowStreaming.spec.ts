import { expect, it, vi } from 'vitest'
import '@/core/framework/TitanThree'
import { Object3D, PerspectiveCamera, Scene, Sphere, Vector3, type WebGLRenderer } from 'three'
import { Engine } from '@/core/Engine'
import type { UpdateContext } from '@/core/UpdateContext'
import { Actor } from '@/core/models/Actor'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import type { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { SceneObserver } from '@/core/services/SceneObserver'
import { CameraCollision } from '@/core/services/CameraCollision'
import { AstroControls } from '@/core/libs/AstroControls'
import { CameraController } from '@/core/camera/CameraController'
import { SimulationClock } from '@/core/time/SimulationClock'
import { HeightFieldGate } from '@/core/services/HeightFieldGate'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { SyncTerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { seedHeightMap } from './helpers/planetSeeds'

/** Real orbital motion, controls, observer and collision; only GPU rendering is omitted. */
function makeFrame(speed: number, fps: number, following = true) {
  const scene = new Scene(), earth = Actor.find(7)!
  const parent = new DynamicNode(Actor.find(2)!), node = new DynamicNode(earth)
  const surface = new Object3D()
  surface.model = earth
  surface.userData.type = 'planet'
  node.add(surface)
  parent.add(node)
  scene.add(parent)
  const camera = new PerspectiveCamera(), controller = new CameraController()
  const controls = new AstroControls(camera, new Sphere(), document.createElement('canvas'))
  const observer = new SceneObserver(), clock = new SimulationClock(2451545)
  const collision = new CameraCollision(camera, observer)
  clock.setSpeedOfTime(speed)
  const update = (ctx: UpdateContext): void => {
    parent.updateObject(ctx)
    node.updateObject(ctx)
    scene.updateMatrixWorld(true)
  }
  update({ epoch: clock.epoch, delta: 0, elapsed: 0, camera })
  const radius = toThreeJSUnits(earth.physicalObject!.getAttribute('radius')!)
  camera.position.copy(node.getWorldPosition(new Vector3())).add(new Vector3(0, 3 * radius, 0))
  observer.observable = controls
  observer.scene = scene
  if (following) controller.setFollowTarget(node)
  const frame = {
    renderClock: { getDelta: () => 1 / fps, elapsedTime: 0 }, stats: null,
    clock, camera: controller, renderCamera: camera, astroControls: controls,
    sceneManager: { update, updateView() {}, updateMarkers() {} }, sceneObserver: observer,
    cameraCollision: collision, scene, labelRenderer: { render() {} }, postprocessing: { render() {} }
  }
  return {
    scene, earth, node, surface, camera, controls, observer, radius, controller,
    render: () => Engine.prototype['renderFrame'].call(frame),
    dispose: () => { controls.dispose(); observer.dispose(); collision.clear(); heightFieldStorage.clear() }
  }
}

function makeGate(frame: ReturnType<typeof makeFrame>) {
  const factory = {
    upgradePlanetToTerrain: vi.fn(() => false),
    downgradeTerrainToPlanet: vi.fn(() => false),
    resyncSurfaceMaterials: vi.fn()
  }
  const gate = new HeightFieldGate(frame.observer, frame.scene, factory as unknown as RenderableFactory,
    { domElement: { height: 1080 } } as unknown as WebGLRenderer, new SyncTerrainPatchBuilder())
  const path = heightPathOf(frame.earth)!
  seedHeightMap(path)
  return { gate, factory, path }
}

it.each([{ speed: 1, fps: 60 }, { speed: 10_000_000, fps: 60 }, { speed: 1_000_000, fps: 10 }])(
  'retains nearby terrain while following Earth at $speed x and $fps FPS', ({ speed, fps }) => {
    const frame = makeFrame(speed, fps)
    const { gate, path } = makeGate(frame)
    const map = heightFieldStorage.get(path)!
    // A regression must be observable without sending an actual HTTP request.
    const request = vi.spyOn(heightFieldStorage, 'request').mockImplementation(() => {})
    try {
      for (let i = 0; i < 64; i++) {
        frame.render()
        expect(heightFieldStorage.get(path)).toBe(map)
        expect(frame.observer.getData(7)!.distance).toBeCloseTo(3 * frame.radius, 6)
        expect(frame.camera.position.distanceTo(frame.node.getWorldPosition(new Vector3()))).toBeCloseTo(3 * frame.radius, 6)
      }
      expect(request).not.toHaveBeenCalled()
    } finally { request.mockRestore(); gate.dispose(); frame.dispose() }
  }
)

it('observes the final collision position during free flight', () => {
  const frame = makeFrame(0, 10, false)
  try {
    const center = frame.node.getWorldPosition(new Vector3())
    frame.camera.position.copy(center).add(new Vector3(0, 0.5 * frame.radius, 0))
    for (let i = 0; i < 4; i++) frame.observer.tick(0.1)
    frame.render()

    const distance = frame.camera.position.distanceTo(center)
    expect(distance).toBeGreaterThan(frame.radius)
    expect(frame.observer.getData(7)!.distance).toBeCloseTo(distance, 6)
    expect(frame.controls.target.distanceTo(center)).toBeLessThan(1e-8)
  } finally { frame.dispose() }
})

it.each([100_000, 150_000_000, 4_500_000_000])('retains terrain after a fast free-flight collision at %s km/s', speed => {
  const frame = makeFrame(0, 60, false)
  const { gate, path } = makeGate(frame)
  const map = heightFieldStorage.get(path)!
  const request = vi.spyOn(heightFieldStorage, 'request').mockImplementation(() => {})
  try {
    frame.render()
    const center = frame.node.getWorldPosition(new Vector3())
    frame.camera.lookAt(center)
    frame.controller.setSpeed(speed)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }))
    frame.render()

    const distance = frame.camera.position.distanceTo(center)
    expect(distance).toBeGreaterThan(frame.radius)
    expect(distance).toBeLessThan(5 * frame.radius)
    expect(heightFieldStorage.get(path)).toBe(map)
    expect(frame.observer.getData(7)!.distance).toBeCloseTo(distance, 6)

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))
    frame.render()
    expect(heightFieldStorage.get(path)).toBe(map)
    expect(request).not.toHaveBeenCalled()
  } finally {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))
    request.mockRestore(); gate.dispose(); frame.dispose()
  }
})

it('keeps the explicit follow target when a different body is closest on the periodic tick', () => {
  const frame = makeFrame(0, 10)
  try {
    const moon = new Object3D()
    moon.model = Actor.find(19)!
    moon.userData.type = 'planet'
    moon.position.copy(frame.camera.position).add(new Vector3(2, 0, 0))
    frame.scene.add(moon)
    frame.observer.refreshObservableObjects()
    for (let i = 0; i < 5; i++) frame.render()

    expect(frame.observer.calculateClosestObject()!.actorId).toBe(19)
    expect(frame.controls.target.distanceTo(frame.node.getWorldPosition(new Vector3()))).toBeLessThan(1e-8)
  } finally { frame.dispose() }
})

it('captures the collision surface before the height gate replaces that surface', () => {
  const frame = makeFrame(0, 10)
  // Consume the initial controls change before connecting the gate.
  frame.controls.update(0)
  frame.observer.tick(0)
  const { gate, factory } = makeGate(frame)
  factory.upgradePlanetToTerrain.mockImplementationOnce(() => {
    frame.node.remove(frame.surface)
    const replacement = new Object3D()
    replacement.model = frame.earth
    replacement.userData.type = 'planet'
    frame.node.add(replacement)
    return true
  })
  try {
    for (let i = 0; i < 4; i++) frame.observer.tick(0.1)
    frame.render()

    expect(frame.surface.parent).toBeNull()
    expect(frame.controls['surface']!.center.distanceTo(frame.node.getWorldPosition(new Vector3()))).toBeLessThan(1e-8)
  } finally { gate.dispose(); frame.dispose() }
})
