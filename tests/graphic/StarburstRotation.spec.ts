import { PerspectiveCamera } from 'three'
import { computeStarburstRotation } from '@/core/graphic/effects/lensflare/starburstRotation'

describe('computeStarburstRotation: старберст доворачивается вместе с объективом', () => {
  it('камера без крена даёт 1', () => {
    const camera = new PerspectiveCamera()
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    expect(computeStarburstRotation(camera.matrixWorld)).toBeCloseTo(1, 5)
  })

  it('крен на 90° меняет значение — маска повернётся', () => {
    const camera = new PerspectiveCamera()
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.rotateZ(Math.PI / 2)
    camera.updateMatrixWorld(true)

    expect(computeStarburstRotation(camera.matrixWorld)).toBeCloseTo(0, 5)
  })

  it('позиция камеры на результат не влияет — это ориентация, а не сцена', () => {
    const a = new PerspectiveCamera()
    a.position.set(0, 0, 10)
    a.lookAt(0, 0, 0)
    a.updateMatrixWorld(true)

    const b = new PerspectiveCamera()
    b.position.set(500, -300, 700)
    b.quaternion.copy(a.quaternion)
    b.updateMatrixWorld(true)

    expect(computeStarburstRotation(b.matrixWorld)).toBeCloseTo(computeStarburstRotation(a.matrixWorld), 5)
  })
})
