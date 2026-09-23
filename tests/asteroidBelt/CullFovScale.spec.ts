import { describe, it, expect, vi } from 'vitest'
import { Matrix4, PerspectiveCamera } from 'three'
import '@/core/framework/TitanThree'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => ({ name: 'ring.png' }),
    getTextureOrMake: () => ({ name: 'ring.png' })
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { Actor } from '@/core/models/Actor'
import type { UpdateContext } from '@/core/UpdateContext'
import { internalsOf, fadeSpeedOf } from '../helpers/ringSystemInternals'

const makeBeltActor = (): Actor =>
  ({
    getAttribute: () => 1,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1 })
    },
    resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
  }) as unknown as Actor

/** Камера кадра — смещена от системы, matrixWorldInverse считается в updateMatrixWorld(Camera). */
function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1.5, 0.1, 1e6)
  camera.position.set(30, 40, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return camera
}

function frame(system: AsteroidRingSystem, camera: PerspectiveCamera): void {
  system.updateObject({ delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext)
}

describe('AsteroidRingSystem: cullFovScale — запас отсечения вокруг кадра', () => {
  it('без cullFovScale матрица отсечения — camera.projectionMatrix × camera.matrixWorldInverse побитово', () => {
    const system = new AsteroidRingSystem(makeBeltActor(), { frame: 'system', planetRadiusKm: 0 })
    system.updateMatrixWorld(true)
    const camera = makeCamera()
    const updateSpy = vi.spyOn(internalsOf(system).cascades, 'update')

    frame(system, camera)

    const expected = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    const actual = updateSpy.mock.calls[0][3] as Matrix4
    expect(actual.elements).toEqual(expected.elements)
  })

  it('cullFovScale: 1.35 — матрица отличается от точной и соответствует расширенному fov', () => {
    const system = new AsteroidRingSystem(makeBeltActor(), {
      frame: 'system',
      planetRadiusKm: 0,
      cullFovScale: 1.35
    })
    system.updateMatrixWorld(true)
    const camera = makeCamera()
    const updateSpy = vi.spyOn(internalsOf(system).cascades, 'update')

    frame(system, camera)

    const exact = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)

    // Та же сборка, что и в производственном коде: своя камера, скопированные
    // fov(×scale)/aspect/near/far, проекция × ТА ЖЕ matrixWorldInverse реальной камеры.
    const wideCamera = new PerspectiveCamera()
    wideCamera.fov = Math.min(camera.fov * 1.35, 179)
    wideCamera.aspect = camera.aspect
    wideCamera.near = camera.near
    wideCamera.far = camera.far
    wideCamera.updateProjectionMatrix()
    const expectedWide = new Matrix4().multiplyMatrices(wideCamera.projectionMatrix, camera.matrixWorldInverse)

    const actual = updateSpy.mock.calls[0][3] as Matrix4
    expect(actual.elements).toEqual(expectedWide.elements)
    expect(actual.elements).not.toEqual(exact.elements)
    // Более широкий fov → меньший диагональный масштаб ДО умножения на вид
    // (после умножения на matrixWorldInverse элементы перемешиваются поворотом камеры)
    expect(wideCamera.projectionMatrix.elements[0]).toBeLessThan(camera.projectionMatrix.elements[0])
  })

  it('экстремальный cullFovScale клампится ниже 179° — камера отсечения не ломается', () => {
    const system = new AsteroidRingSystem(makeBeltActor(), {
      frame: 'system',
      planetRadiusKm: 0,
      cullFovScale: 10
    })
    system.updateMatrixWorld(true)
    const camera = makeCamera()
    const updateSpy = vi.spyOn(internalsOf(system).cascades, 'update')

    frame(system, camera)

    const actual = updateSpy.mock.calls[0][3] as Matrix4
    for (const e of actual.elements) expect(Number.isFinite(e)).toBe(true)
  })
})

describe('AsteroidRingSystem: fadeSeconds — прокидывается в fadeSpeed каждого каскада', () => {
  it('fadeSeconds: 2 даёт fadeSpeed = 0.5 у менеджера', () => {
    const system = new AsteroidRingSystem(makeBeltActor(), { fadeSeconds: 2 })
    expect(fadeSpeedOf(internalsOf(system).cascades.first)).toBeCloseTo(0.5, 10)
  })

  it('без fadeSeconds — дефолт 0.25 (fadeSpeed 4.0), как у колец сегодня', () => {
    const system = new AsteroidRingSystem(makeBeltActor())
    expect(fadeSpeedOf(internalsOf(system).cascades.first)).toBeCloseTo(4.0, 10)
  })
})
