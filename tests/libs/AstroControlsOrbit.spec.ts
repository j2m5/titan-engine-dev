import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Sphere, Vector3 } from 'three'
import { AstroControls } from '@/core/libs/AstroControls'

// Орбитальный поворот берёт радиус из ТЕКУЩЕЙ позиции камеры: коллизия между
// событиями мыши выталкивает камеру наружу, возврат на радиус с mousedown
// загонял бы её обратно в рельеф — дрожание всего видимого рельефа.
function makeControls(): { controls: AstroControls; camera: PerspectiveCamera; dom: HTMLElement } {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  const dom = document.createElement('div')
  // Канвас в документе, как в приложении: отпускание ПКМ слушается на window
  // и доходит туда всплытием
  document.body.appendChild(dom)
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

  it('isOrbiting — true между нажатием и отпусканием ПКМ, ЛКМ не считается', () => {
    const { controls, dom } = makeControls()

    expect(controls.isOrbiting).toBe(false)

    mouse(dom, 'mousedown', 0, 0, 0)
    expect(controls.isOrbiting).toBe(false)

    mouse(dom, 'mousedown', 0, 0)
    expect(controls.isOrbiting).toBe(true)

    mouse(dom, 'mouseup', 0, 0)
    expect(controls.isOrbiting).toBe(false)
  })
})

describe('AstroControls: у поверхности', () => {
  it('ниже порога ПКМ поворачивает взгляд на месте: позиция не меняется, ориентация меняется', () => {
    const { controls, camera, dom } = makeControls()
    const center = new Vector3(0, 0, 0)
    controls.setTarget(center)
    camera.position.set(1000.01, 0, 0)
    camera.lookAt(center)
    controls.setSurface({ center, altitude: 0.01, surfaceRadius: 1000 })
    const before = camera.quaternion.clone()

    mouse(dom, 'mousedown', 100, 100)
    mouse(dom, 'mousemove', 140, 60)

    expect(camera.position.x).toBe(1000.01)
    expect(camera.position.y).toBe(0)
    expect(camera.position.z).toBe(0)
    expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.01)
  })

  it('выше порога — орбита, но угол на пиксель уменьшен в h/(h+R)', () => {
    const near = makeControls()
    const far = makeControls()
    for (const { controls, camera } of [near, far]) {
      controls.setTarget(new Vector3())
      camera.position.set(1100, 0, 0)
    }
    near.controls.setSurface({ center: new Vector3(), altitude: 100, surfaceRadius: 1000 })

    for (const { dom } of [near, far]) {
      mouse(dom, 'mousedown', 100, 100)
      mouse(dom, 'mousemove', 110, 100)
    }

    const angle = (p: Vector3): number => Math.atan2(p.z, p.x)
    expect(angle(near.camera.position)).toBeCloseTo(angle(far.camera.position) * (100 / 1100), 9)
  })

  it('режим выбирается на нажатии: подъём над порогом посреди перетаскивания его не меняет', () => {
    const { controls, camera, dom } = makeControls()
    const center = new Vector3()
    controls.setTarget(center)
    camera.position.set(1000.01, 0, 0)
    controls.setSurface({ center, altitude: 0.01, surfaceRadius: 1000 })

    mouse(dom, 'mousedown', 100, 100)
    controls.setSurface({ center, altitude: 500, surfaceRadius: 1000 })
    mouse(dom, 'mousemove', 140, 100)

    expect(camera.position.x).toBe(1000.01)
  })
})
