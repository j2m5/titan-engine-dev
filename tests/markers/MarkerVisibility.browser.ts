import { Group, PerspectiveCamera, Scene } from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Actor } from '@/core/models/Actor'
import { MarkerManager } from '@/core/services/MarkerManager'
import { SceneObserver } from '@/core/services/SceneObserver'
import type { Settings } from '@/core/ports/Settings'

/** Real DOM layout is required to verify overlap and hit testing after renderer culling. */
export function checkMarkerVisibility(): { frames: boolean[][]; clicked: string[]; cleaned: boolean } {
  const renderer = new CSS2DRenderer()
  renderer.setSize(400, 400)
  Object.assign(renderer.domElement.style, { position: 'fixed', left: '0', top: '0' })
  document.body.appendChild(renderer.domElement)
  const scene = new Scene(), camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.z = 5
  const settings = { showMarkers: true }
  const manager = new MarkerManager(new SceneObserver(), settings as Settings)
  const clicked: string[] = [], frames: boolean[][] = []
  const add = (id: number, name: string, priority: number) => {
    const host = new Group()
    scene.add(host)
    manager.add({ model: new Actor({ id, name }), object: host, shape: 'hex', depth: 0, onClick: () => { clicked.push(name) } })
    const [marker, label] = host.children as CSS2DObject[]
    marker.userData.priority = priority
    Object.assign(marker.element.style, { width: '20px', height: '20px' })
    Object.assign((marker.element.firstElementChild as HTMLElement).style, { width: '100%', height: '100%' })
    Object.assign(label.element.style, { width: '80px', height: '20px', top: '25px' })
    return { host, marker, label }
  }
  const high = add(-1, 'High', 10), low = add(-2, 'Low', 1)
  const visible = (object: CSS2DObject): boolean => {
    const style = getComputedStyle(object.element)
    return style.display !== 'none' && style.visibility !== 'hidden' && object.element.getBoundingClientRect().width > 0
  }
  const frame = (expected: boolean[]) => {
    renderer.render(scene, camera)
    manager.update()
    const actual = [visible(high.marker), visible(low.marker)]
    const labels = [visible(high.label), visible(low.label)]
    frames.push(actual)
    if (actual.some((value, i) => value !== expected[i]) || labels.some((value, i) => value !== expected[i])) {
      throw new Error(`Marker visibility at frame ${frames.length}: ${JSON.stringify({ actual, labels, expected })}`)
    }
  }
  try {
    for (let cycle = 0; cycle < 3; cycle++) frame([true, false])
    high.host.position.z = 10
    frame([false, true])
    // The culled, higher-priority marker must not intercept the visible marker's click.
    const rect = low.marker.element.getBoundingClientRect()
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    if (!target || !low.marker.element.contains(target)) throw new Error('Hidden marker intercepts visible marker hit testing')
    ;(target as HTMLElement).click()
    if (clicked.join(',') !== 'Low') throw new Error(`Incorrect marker click: ${clicked}`)

    high.host.position.z = 0
    frame([true, false])
    low.host.position.x = 1
    frame([true, true])
    low.host.position.x = 0
    frame([true, false])
    for (let cycle = 0; cycle < 2; cycle++) {
      settings.showMarkers = false
      frame([false, false])
      settings.showMarkers = true
      frame([true, false])
    }
    high.host.visible = false
    frame([false, true])
    high.host.visible = true
    frame([true, false])

    // Opacity alone does not remove DOM hit targets. Test the marker and its label separately.
    low.host.position.x = 1
    frame([true, true])
    const highRects = [high.marker, high.label].map(object => object.element.getBoundingClientRect())
    high.marker.element.style.opacity = '0'
    high.label.element.style.opacity = '0'
    frame([false, true])
    for (const bounds of highRects) {
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      if (hit && (high.marker.element.contains(hit) || high.label.element.contains(hit))) {
        throw new Error('Fully transparent marker or label intercepts pointer input')
      }
    }
    low.host.position.x = 0
    frame([false, true])
    const lowRect = low.marker.element.getBoundingClientRect()
    const lowHit = document.elementFromPoint(lowRect.x + lowRect.width / 2, lowRect.y + lowRect.height / 2)
    if (!lowHit || !low.marker.element.contains(lowHit)) throw new Error('Faded marker blocks its visible peer')
    ;(lowHit as HTMLElement).click()
    high.marker.element.style.opacity = '0.5'
    high.label.element.style.opacity = '0.5'
    frame([true, false])
    const highRect = high.marker.element.getBoundingClientRect()
    const highHit = document.elementFromPoint(highRect.x + highRect.width / 2, highRect.y + highRect.height / 2)
    if (!highHit || !high.marker.element.contains(highHit)) throw new Error('Partially faded marker did not regain pointer input')
    ;(highHit as HTMLElement).click()
    if (clicked.join(',') !== 'Low,Low,High') throw new Error(`Incorrect clicks after fade recovery: ${clicked}`)

    manager.dispose()
    if (renderer.domElement.childElementCount !== 0 || high.host.children.length || low.host.children.length) {
      throw new Error('Disposed markers remain in the DOM or scene graph')
    }
    const replacement = add(-3, 'Replacement', 1)
    renderer.render(scene, camera)
    manager.update()
    if (!visible(replacement.marker) || !visible(replacement.label)) throw new Error('New markers inherited stale suppression')
    manager.dispose()
    const cleaned = renderer.domElement.childElementCount === 0
    if (!cleaned) throw new Error('Replacement markers leaked DOM nodes')
    return { frames, clicked, cleaned }
  } finally {
    manager.dispose()
    renderer.domElement.remove()
  }
}
