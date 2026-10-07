import { describe, it, expect, vi } from 'vitest'
import { Group, Mesh, OrthographicCamera, PerspectiveCamera } from 'three'
import { config } from '@/core/framework/config'
import { frameCoverage, frameHeightAt } from '@/core/helpers/apparentSize'
import { nextSphereLevel, SphereDetail } from '@/core/renderables/utils/SphereDetail'
import { circumscribeFactor } from '@/core/renderables/utils/sphereGeometry'

const FOV: number = 50
const RADIUS: number = 2.5
const DENSE: number = config('sphereDetail.denseCoverage')
const COARSE: number = config('sphereDetail.coarseCoverage')

/** Дистанция до центра, на которой тело радиуса radius занимает долю кадра coverage */
function distanceFor(coverage: number, radius: number = RADIUS): number {
  return (2 * radius) / (coverage * frameHeightAt(1, FOV))
}

/** Камера на оси z на дистанции distance; x — сдвиг вбок вместе с телом */
function cameraAt(distance: number, x: number = 0): PerspectiveCamera {
  const camera = new PerspectiveCamera(FOV, 1, 0.01, 1e9)

  camera.position.set(x, 0, distance)

  return camera
}

function vertexCount(mesh: Mesh): number {
  return mesh.geometry.getAttribute('position').count
}

function detailOf(
  denseSegments: number = 256,
  circumscribeDense: boolean = false,
  radius: number = RADIUS
): { mesh: Mesh; detail: SphereDetail } {
  const mesh = new Mesh()

  return { mesh, detail: new SphereDetail(mesh, radius, { denseSegments, circumscribeDense }) }
}

describe('nextSphereLevel — гистерезис', () => {
  it('ровно denseCoverage — плотная', () => {
    expect(nextSphereLevel('coarse', DENSE, DENSE, COARSE)).toBe('dense')
  })

  it('чуть ниже denseCoverage грубая остаётся грубой', () => {
    expect(nextSphereLevel('coarse', DENSE - 1e-9, DENSE, COARSE)).toBe('coarse')
  })

  it('между порогами уровень держится в обе стороны', () => {
    const middle = (DENSE + COARSE) / 2

    expect(nextSphereLevel('coarse', middle, DENSE, COARSE)).toBe('coarse')
    expect(nextSphereLevel('dense', middle, DENSE, COARSE)).toBe('dense')
  })

  it('ровно coarseCoverage плотная остаётся плотной', () => {
    expect(nextSphereLevel('dense', COARSE, DENSE, COARSE)).toBe('dense')
  })

  it('ниже coarseCoverage — грубая', () => {
    expect(nextSphereLevel('dense', COARSE - 1e-9, DENSE, COARSE)).toBe('coarse')
  })
})

describe('конфиг sphereDetail', () => {
  it('порог освобождения ниже порога постройки — иначе дрожь на границе', () => {
    expect(COARSE).toBeLessThan(DENSE)
    expect(config('sphereDetail.coarseSegments')).toBe(64)
  })
})

describe('frameCoverage рядом с frameHeightAt', () => {
  it('2R к высоте кадра на дистанции', () => {
    expect(frameCoverage(RADIUS, 10, FOV)).toBeCloseTo((2 * RADIUS) / frameHeightAt(10, FOV), 12)
  })
})

describe('SphereDetail', () => {
  it('стартует грубой сферой 64×64', () => {
    const { mesh, detail } = detailOf()

    expect(detail.level).toBe('coarse')
    expect(vertexCount(mesh)).toBe(65 * 65)
    expect(mesh.geometry.boundingSphere!.radius).toBe(RADIUS)
  })

  it('крупно в кадре — плотная, прежняя задиспожена ровно один раз', () => {
    const { mesh, detail } = detailOf()
    const dispose = vi.spyOn(mesh.geometry, 'dispose')

    detail.update(cameraAt(distanceFor(0.5)))

    expect(detail.level).toBe('dense')
    expect(vertexCount(mesh)).toBe(257 * 257)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('уровень не изменился — та же геометрия, ничего не строится', () => {
    const { mesh, detail } = detailOf()

    detail.update(cameraAt(distanceFor(0.5)))

    const dense = mesh.geometry

    detail.update(cameraAt(distanceFor(0.2)))
    detail.update(cameraAt(distanceFor(0.6)))

    expect(mesh.geometry).toBe(dense)
  })

  it('отъезд ниже coarseCoverage — грубая, плотная задиспожена', () => {
    const { mesh, detail } = detailOf()

    detail.update(cameraAt(distanceFor(0.5)))

    const dispose = vi.spyOn(mesh.geometry, 'dispose')

    detail.update(cameraAt(distanceFor(0.1)))

    expect(detail.level).toBe('coarse')
    expect(vertexCount(mesh)).toBe(65 * 65)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('плотная сегментация — своя у владельца (оболочка гиганта — 128)', () => {
    const { mesh, detail } = detailOf(128)

    detail.update(cameraAt(distanceFor(0.5)))

    expect(vertexCount(mesh)).toBe(129 * 129)
  })

  it('доля считается по мировой позиции: меш в смещённом родителе, без updateMatrixWorld', () => {
    const parent = new Group()
    const mesh = new Mesh()

    parent.position.set(1000, 0, 0)
    parent.add(mesh)

    const detail = new SphereDetail(mesh, RADIUS, { denseSegments: 256, circumscribeDense: false })

    // Камера рядом с фактической позицией тела: matrixWorld не обновлялась, и
    // если бы её не обновил getWorldPosition, тело «стояло» бы в начале координат
    detail.update(cameraAt(distanceFor(0.5), 1000))

    expect(detail.level).toBe('dense')
  })

  it('камера у начала координат не видит тело, стоящее в 1000 юнитах', () => {
    const parent = new Group()
    const mesh = new Mesh()

    parent.position.set(1000, 0, 0)
    parent.add(mesh)

    const detail = new SphereDetail(mesh, RADIUS, { denseSegments: 256, circumscribeDense: false })

    detail.update(cameraAt(distanceFor(0.5)))

    expect(detail.level).toBe('coarse')
  })

  it('circumscribeDense: грубая вписана (радиус точный), плотная описана под 256', () => {
    const { mesh, detail } = detailOf(256, true)

    expect(mesh.geometry.boundingSphere!.radius).toBe(RADIUS)

    detail.update(cameraAt(distanceFor(0.5)))

    expect(mesh.geometry.boundingSphere!.radius).toBeCloseTo(RADIUS * circumscribeFactor(256), 12)
  })

  describe('observe — кадр рендера важнее устаревшего update', () => {
    function ready(far: PerspectiveCamera, near: PerspectiveCamera): { mesh: Mesh; detail: SphereDetail } {
      const made = detailOf()

      far.updateMatrixWorld()
      near.updateMatrixWorld()
      made.mesh.updateMatrixWorld()

      return made
    }

    it('update по устаревшей камере, но отрисовано вблизи — на следующем update плотная', () => {
      const far = cameraAt(distanceFor(0.01))
      const near = cameraAt(distanceFor(0.5))
      const { mesh, detail } = ready(far, near)

      detail.update(far)
      expect(detail.level).toBe('coarse')

      detail.observe(near)
      detail.update(far)

      expect(detail.level).toBe('dense')
      expect(vertexCount(mesh)).toBe(257 * 257)
    })

    it('observe сам геометрию не трогает', () => {
      const far = cameraAt(distanceFor(0.01))
      const near = cameraAt(distanceFor(0.5))
      const { mesh, detail } = ready(far, near)
      const coarse = mesh.geometry

      detail.observe(near)

      expect(mesh.geometry).toBe(coarse)
      expect(detail.level).toBe('coarse')
    })

    it('одноразово: без нового observe следующий update опирается на свой замер', () => {
      const far = cameraAt(distanceFor(0.01))
      const near = cameraAt(distanceFor(0.5))
      const { detail } = ready(far, near)

      detail.observe(near)
      detail.update(far)
      expect(detail.level).toBe('dense')

      detail.update(far)

      expect(detail.level).toBe('coarse')
    })

    it('ортографическая камера в observe игнорируется', () => {
      const far = cameraAt(distanceFor(0.01))
      const near = cameraAt(distanceFor(0.5))
      const { detail } = ready(far, near)
      const ortho = new OrthographicCamera(-1, 1, 1, -1, 0.01, 1e9)

      ortho.position.set(0, 0, distanceFor(0.5))
      ortho.updateMatrixWorld()

      detail.observe(ortho)
      detail.update(far)

      expect(detail.level).toBe('coarse')
    })
  })


  it('невидимый меш (импостор LOD, телепорт) тоже освобождает плотную', () => {
    const { mesh, detail } = detailOf()

    detail.update(cameraAt(distanceFor(0.5)))
    mesh.visible = false
    detail.update(cameraAt(distanceFor(0.01)))

    expect(detail.level).toBe('coarse')
  })

  it('камера в центре тела (внутри оболочки) — плотная, без NaN', () => {
    const { mesh, detail } = detailOf()

    expect(() => detail.update(cameraAt(0))).not.toThrow()
    expect(detail.level).toBe('dense')
    expect(mesh.geometry.boundingSphere!.radius).toBe(RADIUS)
  })

  it('нулевой радиус — грубая навсегда, без исключений', () => {
    const { mesh, detail } = detailOf(256, false, 0)

    expect(() => detail.update(cameraAt(1))).not.toThrow()
    expect(detail.level).toBe('coarse')
    expect(vertexCount(mesh)).toBe(65 * 65)
  })
})
