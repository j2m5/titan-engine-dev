import { PerspectiveCamera, Scene } from 'three'
import { Crosshair } from '@/core/renderables/utils/Crosshair'

/**
 * Стрелка прицела за кадром показывает, куда повернуть к цели. Камера в начале
 * координат смотрит вдоль −Z, правая сторона экрана — +X.
 */
function setup(x: number, y: number, z: number): HTMLElement {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000)
  const scene = new Scene()
  const crosshair = new Crosshair()

  scene.add(camera, crosshair)
  crosshair.position.set(x, y, z)
  scene.updateMatrixWorld()
  camera.updateMatrixWorld()

  crosshair.updateObject({ delta: 0, epoch: 0, elapsed: 0, camera })

  return (crosshair as unknown as { arrow: HTMLElement }).arrow
}

function arrowCenterX(arrow: HTMLElement): number {
  return parseFloat(arrow.style.left)
}

describe('Crosshair: стрелка к цели за кадром', () => {
  it('цель в кадре — стрелки нет', () => {
    expect(setup(0, 0, -10).style.display).toBe('none')
  })

  it('цель справа впереди за краем кадра — стрелка у правого края', () => {
    const arrow = setup(100, 0, -10)

    expect(arrow.style.display).toBe('block')
    expect(arrowCenterX(arrow)).toBeGreaterThan(window.innerWidth / 2)
  })

  it('цель справа ПОЗАДИ — стрелка тоже справа: проекция за камерой не зеркалит направление', () => {
    const arrow = setup(5, 0, 10)

    expect(arrow.style.display).toBe('block')
    expect(arrowCenterX(arrow)).toBeGreaterThan(window.innerWidth / 2)
  })

  it('цель сверху позади — стрелка у верхнего края', () => {
    const arrow = setup(0, 5, 10)

    expect(parseFloat(arrow.style.top)).toBeLessThan(window.innerHeight / 2)
  })

  it('цель строго позади — позиция стрелки конечна (без NaN), стрелка внизу', () => {
    const arrow = setup(0, 0, 10)

    expect(arrow.style.display).toBe('block')
    expect(Number.isFinite(parseFloat(arrow.style.left))).toBe(true)
    expect(parseFloat(arrow.style.top)).toBeGreaterThan(window.innerHeight / 2)
    expect(arrow.style.transform).not.toContain('NaN')
  })

  it('цель впереди за far — прицел скрыт CSS2DRenderer, стрелка показывает в её сторону', () => {
    const arrow = setup(1000, 0, -5000)

    expect(arrow.style.display).toBe('block')
    expect(arrowCenterX(arrow)).toBeGreaterThan(window.innerWidth / 2)
  })
})
