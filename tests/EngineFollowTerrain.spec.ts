import { expect, it } from 'vitest'
import '@/core/framework/TitanThree'
import { Mesh, PerspectiveCamera, Raycaster, Scene, Sphere, Vector3, type WebGLRenderer } from 'three'
import { Engine } from '@/core/Engine'
import type { UpdateContext } from '@/core/UpdateContext'
import { Actor } from '@/core/models/Actor'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { WaterSphere } from '@/core/renderables/Water/WaterSphere'
import { AstroControls } from '@/core/libs/AstroControls'
import { CameraController } from '@/core/camera/CameraController'
import { SimulationClock } from '@/core/time/SimulationClock'
import { SceneManager } from '@/core/services/SceneManager'
import { fromKilometers, toThreeJSUnits } from '@/core/helpers/scaling'

it.each([1, 10_000])('keeps water geometry near its analytical surface while following Earth at %s x', (speed) => {
  const scene = new Scene(), earth = Actor.find(7)!
  const parent = new DynamicNode(Actor.find(2)!), node = new DynamicNode(earth)
  parent.add(node)
  scene.add(parent)
  const renderer = { domElement: { height: 1080 }, extensions: { has: () => false } } as unknown as WebGLRenderer
  const water = new WaterSphere(earth, 0, renderer)
  node.add(water)
  // The real surface orientation, with only the terrain material/GPU omitted.
  node.renderable = water as unknown as NonNullable<DynamicNode['renderable']>
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  const clock = new SimulationClock(2451545)
  clock.setSpeedOfTime(speed)
  const initialContext: UpdateContext = { epoch: clock.epoch, delta: 0, elapsed: 0, camera }
  parent.updateObject(initialContext)
  node.updateObject(initialContext)
  const radius = toThreeJSUnits(earth.physicalObject!.getAttribute('radius')!)
  camera.position.copy(node.getWorldPosition(new Vector3())).add(new Vector3(0, radius + toThreeJSUnits(0.05), 0))
  camera.lookAt(node.getWorldPosition(new Vector3()))
  const controls = new AstroControls(camera, new Sphere(), document.createElement('canvas'))
  const follow = new CameraController()
  follow.setFollowTarget(node)
  const manager = { scene, orbitLines: [], settings: { showOrbitLines: false }, factory: { eclipses: { update() {} } } }
  const frame = {
    renderClock: { getDelta() { this.elapsedTime += 1 / 60; return 1 / 60 }, elapsedTime: 0 }, stats: null,
    clock, camera: follow, renderCamera: camera, astroControls: controls,
    sceneManager: {
      update(ctx: UpdateContext) { SceneManager.prototype.update.call(manager, ctx) },
      updateView(finalCamera: PerspectiveCamera) { SceneManager.prototype.updateView.call(manager, finalCamera) },
      updateMarkers() {}
    },
    sceneObserver: { tick() {} },
    cameraCollision: { translateReferenceFrame() {}, resolve() {}, nearestSurface: () => null },
    scene, labelRenderer: { render() {} }, postprocessing: { render() {} }
  }
  try {
    for (let i = 0; i < 90; i++) Engine.prototype['renderFrame'].call(frame)

    const center = node.getWorldPosition(new Vector3())
    expect(fromKilometers(camera.position.distanceTo(center) - radius) * 1000).toBeCloseTo(50, 4)
    const ray = new Raycaster(camera.position, center.sub(camera.position).normalize())
    const hit = ray.intersectObjects(water.children.filter(child => child instanceof Mesh && child.visible), false)[0]
    expect(hit).toBeDefined()
    // Geometry must meet the camera's real 50 m altitude, not the pre-Follow position.
    expect(Math.abs(fromKilometers(hit.distance) * 1000 - 50)).toBeLessThan(1)
  } finally { water.dispose(); controls.dispose() }
})
