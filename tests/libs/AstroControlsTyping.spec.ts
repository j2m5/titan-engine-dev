import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera, Sphere, Vector3 } from 'three'
import { AstroControls } from '@/core/libs/AstroControls'

/**
 * Клавиши камеры слушаются на окне: набор текста в поле (поиск по объектам)
 * не должен двигать камеру — «west» в поиске иначе летел бы W/S/D.
 */

let controls: AstroControls | null = null

afterEach(() => {
  controls?.dispose()
  controls = null
  document.body.innerHTML = ''
})

function make(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  const dom = document.createElement('div')

  document.body.appendChild(dom)
  camera.position.set(10, 0, 0)
  controls = new AstroControls(camera, new Sphere(new Vector3(), 1), dom)
  controls.setTarget(new Vector3())

  return camera
}

function pressW(target: EventTarget): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }))
}

describe('AstroControls: набор текста не двигает камеру', () => {
  it.each(['input', 'textarea', 'select'])('W, нажатая в %s, камеру не двигает', (tag: string) => {
    const camera = make()
    const field = document.createElement(tag)

    document.body.appendChild(field)
    pressW(field)

    const before = camera.position.clone()

    controls!.update(1)

    expect(camera.position.equals(before)).toBe(true)
  })

  it('W в contenteditable камеру не двигает', () => {
    const camera = make()
    const editable = document.createElement('div')

    editable.setAttribute('contenteditable', 'true')
    document.body.appendChild(editable)
    pressW(editable)

    const before = camera.position.clone()

    controls!.update(1)

    expect(camera.position.equals(before)).toBe(true)
  })

  it('W вне полей ввода по-прежнему двигает камеру', () => {
    const camera = make()

    pressW(document.body)

    const before = camera.position.clone()

    controls!.update(1)

    expect(camera.position.equals(before)).toBe(false)
  })
})
