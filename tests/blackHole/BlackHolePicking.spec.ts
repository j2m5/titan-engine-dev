import '@/core/framework/TitanThree'
import { afterEach, expect, it } from 'vitest'
import { Group, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, type WebGLRenderer } from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Engine } from '@/core/Engine'
import { BlackHole } from '@/core/renderables/BlackHole/BlackHole'
import { BlackHoleImpostor } from '@/core/renderables/BlackHole/BlackHoleImpostor'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { Crosshair } from '@/core/renderables/utils/Crosshair'
import { BLACK_HOLE_LAYER } from '@/core/graphic/passes/DepthVolume'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { Actor } from '@/core/models/Actor'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).reverse().forEach(cleanup => cleanup()))

function setup() {
  const actor = {
    physicalObject: { getAttribute: (key: string, fallback?: unknown) =>
      key === 'mass' ? 7.9564e36 : key === 'temperature' ? 6500 : fallback },
    renderingObject: { getAttribute: () => ({}) },
    getAttribute: (_key: string, fallback?: unknown) => fallback
  } as unknown as Actor
  const renderer = { domElement: { height: window.innerHeight } } as WebGLRenderer
  const body = new BlackHole(actor, { sceneBackground: null } as ResourceObserver)
  const impostor = new BlackHoleImpostor(actor, body.parameters, renderer)
  const lod = new ApparentSizeLod(body.parameters.simulationRadius, renderer, config('blackHole.lodPixels'))
  const threshold = lod.switchDistance(50)
  lod.addLevel(body)
  lod.addLevel(impostor, threshold, config('blackHole.lodHysteresis'))
  const scene = new Scene().add(new Group().add(lod))
  const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.001, threshold * 1e6)
  camera.up.set(0, 0, 1)
  const crosshair = new Crosshair(), labels = new CSS2DRenderer()
  labels.setSize(window.innerWidth, window.innerHeight)
  const raycaster = new Raycaster()
  raycaster.layers.enable(BLACK_HOLE_LAYER)
  const frame = { scene, renderCamera: camera, raycaster, sceneManager: { crosshair } }
  cleanups.push(() => {
    disposeSceneTree(scene)
    crosshair.element.remove()
    crosshair['arrow'].remove()
    labels.domElement.remove()
  })
  const atDistance = (multiple: number): void => {
    camera.position.set(0, threshold * multiple, 0)
    camera.lookAt(0, 0, 0)
    impostor.updateObject({ camera, delta: 0, elapsed: 0, epoch: 0 })
    lod.updateView(camera)
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    labels.render(scene, camera)
  }
  const click = (clientX: number, clientY: number): void => {
    Engine.prototype['onClick'].call(frame as unknown as Engine, new MouseEvent('click', { clientX, clientY }))
    labels.render(scene, camera)
  }
  atDistance(1000)
  return { body, impostor, camera, scene, crosshair, raycaster, atDistance, click }
}

it.each(['Shadow', 'Ring'] as const)('keeps a mouse-selected far %s crosshair visible through repeated LOD crossings', kind => {
  const f = setup()
  expect(f.impostor.visible).toBe(true)
  expect(f.body.visible).toBe(false)
  const target = new Vector3()
  if (kind === 'Ring') {
    const { diskInnerRadius, diskOuterRadius } = f.body.parameters
    target.x = toThreeJSUnits((diskInnerRadius + diskOuterRadius) / 2) * f.impostor.scale.x
  }
  const ndc = target.project(f.camera)
  const event = new MouseEvent('click', {
    clientX: (ndc.x + 1) * window.innerWidth / 2,
    clientY: (1 - ndc.y) * window.innerHeight / 2
  })
  // Ensure this exercises the far child, not the analytic near-body raycast.
  f.raycaster.setFromCamera(new Vector2(event.clientX / window.innerWidth * 2 - 1, 1 - event.clientY / window.innerHeight * 2), f.camera)
  const hit = f.raycaster.intersectObjects(f.scene.getObjectsByUserDataProperty('clickable', true), false)[0]
  expect(hit.object.name.endsWith(kind)).toBe(true)
  f.click(event.clientX, event.clientY)
  expect(f.crosshair.parent).not.toBeNull()
  expect(f.crosshair.element.style.display).not.toBe('none')
  for (const distance of [0.5, 1000, 0.4, 1000]) {
    f.atDistance(distance)
    expect(f.impostor.visible).toBe(distance > 1)
    expect(f.crosshair.element.style.display).not.toBe('none')
  }
})

it('still clears the selected crosshair when clicking empty space', () => {
  const f = setup()
  f.click(window.innerWidth / 2, window.innerHeight / 2)
  expect(f.crosshair.parent).not.toBeNull()
  f.click(0, 0)
  expect(f.crosshair.parent).toBeNull()
})
