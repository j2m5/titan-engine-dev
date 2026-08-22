import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Sphere, Vector3 } from 'three'
import { AstroControls } from '@/core/libs/AstroControls'

// Орбитальный поворот берёт радиус из ТЕКУЩЕЙ позиции камеры: коллизия между
// событиями мыши выталкивает камеру наружу, возврат на радиус с mousedown
// загонял бы её обратно в рельеф — дрожание всего видимого рельефа.
function makeControls(): { controls: AstroControls; camera: PerspectiveCamera; dom: HTMLElement } {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  const dom = document.createElement('div')
  const controls = new AstroControls(camera, new Sphere(new Vector3(), 1), dom)
  return { controls, camera, dom }
}

function mouse(dom: HTMLElement, type: string, x: number, y: number, button: number = 2): void {
  dom.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true }))
}

describe('AstroControls: орбитальный поворот и внешнее смещение камеры', () => {
  it('радиус орбиты следует за позицией, изменённой между событиями мыши (выталкивание коллизией)', () => {
    const { controls, camera, dom } = makeControls()
    const target = new Vector3(75000, 0, 0)
    controls.setTarget(target)
    camera.position.set(75010, 0, 0)

    mouse(dom, 'mousedown', 100, 100)
    mouse(dom, 'mousemove', 101, 100)
    // коллизия вытолкнула камеру наружу на 0.5 юнита
    const outward = camera.position.clone().sub(target).normalize().multiplyScalar(0.5)
    camera.position.add(outward)
    const pushedRadius = camera.position.distanceTo(target)

    mouse(dom, 'mousemove', 102, 100)

    expect(camera.position.distanceTo(target)).toBeCloseTo(pushedRadius, 9)
    expect(camera.position.distanceTo(target)).toBeGreaterThan(10.4)
  })

  it('без внешнего смещения радиус орбиты стабилен при серии движений', () => {
    const { controls, camera, dom } = makeControls()
    const target = new Vector3(0, 0, 0)
    controls.setTarget(target)
    camera.position.set(10, 0, 0)

    mouse(dom, 'mousedown', 0, 0)
    for (let i = 1; i <= 20; i++) mouse(dom, 'mousemove', i * 3, i)

    expect(camera.position.distanceTo(target)).toBeCloseTo(10, 9)
  })
})
