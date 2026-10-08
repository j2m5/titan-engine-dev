import { describe, expect, it, afterEach } from 'vitest'
import { PerspectiveCamera, Sphere, Vector3 } from 'three'
import { AstroControls } from '@/core/libs/AstroControls'

/**
 * Ввод не залипает: отпускание кнопки или клавиши и потеря фокуса окна всегда
 * сбрасывают зажатое, где бы это ни случилось и в каком бы состоянии ни было
 * управление.
 */

let controls: AstroControls | null = null

afterEach(() => {
  controls?.dispose()
  controls = null
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
})

function make(): { camera: PerspectiveCamera; dom: HTMLElement } {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  const dom = document.createElement('div')

  document.body.appendChild(dom)
  camera.position.set(10, 0, 0)
  controls = new AstroControls(camera, new Sphere(new Vector3(), 1), dom)
  controls.setTarget(new Vector3())

  return { camera, dom }
}

function mouse(target: EventTarget, type: string, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 2, bubbles: true }))
}

function key(type: 'keydown' | 'keyup', code: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }))
}

describe('AstroControls: ввод не залипает', () => {
  it('ПКМ отпущена над интерфейсом, а не над канвасом — вращение кончается', () => {
    const { camera, dom } = make()

    mouse(dom, 'mousedown', 100, 100)
    // список объектов / верхняя панель лежат поверх канваса
    mouse(document.body, 'mouseup', 100, 100)

    const before = camera.position.clone()

    mouse(dom, 'mousemove', 140, 100)

    expect(camera.position.equals(before)).toBe(true)
  })

  it('окно потеряло фокус (Alt-Tab) с зажатой W — камера не летит дальше', () => {
    const { camera } = make()

    key('keydown', 'KeyW')
    window.dispatchEvent(new Event('blur'))

    const before = camera.position.clone()

    controls!.update(1)

    expect(camera.position.equals(before)).toBe(true)
  })

  it('вкладка скрыта с зажатой клавишей — то же', () => {
    const { camera } = make()

    key('keydown', 'KeyD')
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    const before = camera.position.clone()

    controls!.update(1)

    expect(camera.position.equals(before)).toBe(true)
  })

  it('W отпущена, пока управление выключено (полёт к объекту) — после включения камера стоит', () => {
    const { camera } = make()

    key('keydown', 'KeyW')
    controls!.enabled = false
    key('keyup', 'KeyW')
    controls!.enabled = true

    const before = camera.position.clone()

    controls!.update(1)

    expect(camera.position.equals(before)).toBe(true)
  })

  it('после dispose слушатели окна сняты', () => {
    const { camera } = make()

    controls!.dispose()
    key('keydown', 'KeyW')

    const before = camera.position.clone()

    controls!.update(1)

    expect(camera.position.equals(before)).toBe(true)
  })
})
