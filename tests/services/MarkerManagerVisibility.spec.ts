import { afterEach, describe, expect, it } from 'vitest'
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Actor } from '@/core/models/Actor'
import { MarkerManager } from '@/core/services/MarkerManager'
import { SceneObserver } from '@/core/services/SceneObserver'
import type { Settings } from '@/core/ports/Settings'
import type { UpdateContext } from '@/core/UpdateContext'
import type { DistanceBasedCSS2DObject } from '@/core/renderables/utils/DistanceBasedCSS2DObject'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { observedActor } from './observedActor'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

function fixture(model = new Actor({ id: -1, name: 'Visibility test' })) {
  const renderer = new CSS2DRenderer()
  renderer.setSize(400, 400)
  document.body.appendChild(renderer.domElement)
  const scene = new Scene(), host = new Group(), camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.z = 5
  scene.add(host)
  const settings = { showMarkers: true }
  const observer = new SceneObserver()
  const manager = new MarkerManager(observer, settings as Settings)
  manager.add({ model, object: host, shape: 'hex', depth: 0 })
  const [marker, label] = host.children as CSS2DObject[]
  cleanups.push(() => { manager.dispose(); renderer.domElement.remove() })
  return { renderer, scene, camera, host, settings, manager, marker, label, observer }
}

function visible(object: CSS2DObject): boolean {
  const style = getComputedStyle(object.element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

describe('MarkerManager renderer visibility', () => {
  it('excludes fully faded markers and restores partial-opacity interaction as distance changes', () => {
    const model = observedActor('Moon')
    const f = fixture(model)
    const radius = toThreeJSUnits(model.physicalObject!.getAttribute('radius')!)
    const actorId = model.getAttribute('id')!
    const objects = [f.marker, f.label] as DistanceBasedCSS2DObject[]
    for (const [distanceRadii, opacity, shown] of [
      [2, 0, false], [6, 0.5, true], [8, 1, true], [4, 0, false], [6, 0.5, true]
    ] as const) {
      f.observer.data.set(actorId, { actorId, name: 'Moon', distance: radius * distanceRadii, position: new Vector3() })
      for (const object of objects) object.updateObject({} as UpdateContext)
      f.renderer.render(f.scene, f.camera)
      f.manager.update()
      for (const object of objects) {
        expect(Number(object.element.style.opacity)).toBeCloseTo(opacity)
        expect(visible(object)).toBe(shown)
      }
    }
  })

  it.each(['behind', 'near', 'far', 'ancestor', 'layers'] as const)('preserves %s culling and recovers when the object returns', reason => {
    const f = fixture()
    f.renderer.render(f.scene, f.camera)
    f.manager.update()
    expect([visible(f.marker), visible(f.label)]).toEqual([true, true])
    if (reason === 'behind') f.host.position.z = 10
    if (reason === 'near') f.host.position.z = 4.95
    if (reason === 'far') f.host.position.z = -200
    if (reason === 'ancestor') f.host.visible = false
    if (reason === 'layers') { f.marker.layers.set(1); f.label.layers.set(1) }
    f.renderer.render(f.scene, f.camera)
    expect([visible(f.marker), visible(f.label)]).toEqual([false, false])
    f.manager.update()
    expect([visible(f.marker), visible(f.label)]).toEqual([false, false])

    f.host.position.z = 0
    f.host.visible = true
    f.marker.layers.set(0)
    f.label.layers.set(0)
    f.renderer.render(f.scene, f.camera)
    f.manager.update()
    expect([visible(f.marker), visible(f.label)]).toEqual([true, true])
  })

  it('preserves independently culled label visibility', () => {
    const f = fixture()
    f.label.layers.set(1)
    f.renderer.render(f.scene, f.camera)
    f.manager.update()
    expect([visible(f.marker), visible(f.label)]).toEqual([true, false])
  })

  it('toggles settings repeatedly without revealing culled markers', () => {
    const f = fixture()
    f.renderer.render(f.scene, f.camera)
    for (let cycle = 0; cycle < 2; cycle++) {
      f.settings.showMarkers = false
      f.manager.update()
      expect([visible(f.marker), visible(f.label)]).toEqual([false, false])
      f.settings.showMarkers = true
      f.manager.update()
      expect([visible(f.marker), visible(f.label)]).toEqual([true, true])
    }
    f.host.position.z = 10
    f.renderer.render(f.scene, f.camera)
    f.settings.showMarkers = false
    f.manager.update()
    f.settings.showMarkers = true
    f.manager.update()
    expect([visible(f.marker), visible(f.label)]).toEqual([false, false])
  })
})
