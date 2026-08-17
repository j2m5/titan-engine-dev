import { describe, it, expect, vi } from 'vitest'
import { CameraController } from '@/core/camera/CameraController'
import { Object3D, Vector3 } from 'three'

describe('CameraController', () => {
  it('adjust вверх умножает скорость на 1.1', () => {
    const c = new CameraController()
    c.setSpeed(1000)
    c.adjust(-1) // deltaY < 0 → *1.1
    expect(c.speed).toBeCloseTo(1100)
  })

  it('adjust вниз умножает скорость на 0.9', () => {
    const c = new CameraController()
    c.setSpeed(1000)
    c.adjust(1) // deltaY >= 0 → *0.9
    expect(c.speed).toBeCloseTo(900)
  })

  it('adjust ограничивает maxSpeed', () => {
    const c = new CameraController()
    c.setSpeed(c.maxSpeed)
    c.adjust(-1)
    expect(c.speed).toBe(c.maxSpeed)
  })

  it('adjust ограничивает minSpeed', () => {
    const c = new CameraController()
    c.setSpeed(c.minSpeed)
    c.adjust(1)
    expect(c.speed).toBe(c.minSpeed)
  })

  it('setSpeed НЕ клампит (паритет со старым cameraStore)', () => {
    const c = new CameraController()
    c.setSpeed(c.maxSpeed * 2)
    expect(c.speed).toBe(c.maxSpeed * 2)
  })

  it('эмитит change при setSpeed и adjust', () => {
    const c = new CameraController()
    const cb = vi.fn()
    c.subscribe('change', cb)
    c.setSpeed(500)
    c.adjust(-1)
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('повторный toggle той же цели выключает слежение, другая цель переключает его напрямую', () => {
    const c = new CameraController()
    const first = new Object3D()
    const second = new Object3D()

    c.toggleFollow(first)
    expect(c.followTarget).toBe(first)

    c.toggleFollow(second)
    expect(c.followTarget).toBe(second)

    c.toggleFollow(second)
    expect(c.followTarget).toBeNull()
  })

  it('переносит камеру на мировую дельту вложенной цели и сохраняет относительную позицию', () => {
    const c = new CameraController()
    const parent = new Object3D()
    const target = new Object3D()
    const cameraPosition = new Vector3(3, 4, 5)

    parent.position.set(10, 20, 30)
    target.position.set(1, 2, 3)
    parent.add(target)

    c.toggleFollow(target)
    const relativeBefore = target.getWorldPosition(new Vector3()).sub(cameraPosition)

    parent.position.add(new Vector3(7, -4, 9))
    const update = c.updateFollow(cameraPosition)
    const relativeAfter = target.getWorldPosition(new Vector3()).sub(cameraPosition)

    expect(update?.displacement.toArray()).toEqual([7, -4, 9])
    expect(update?.targetPosition.toArray()).toEqual([18, 18, 42])
    expect(relativeAfter.toArray()).toEqual(relativeBefore.toArray())
  })

  it('переключение на удалённую цель не телепортирует камеру', () => {
    const c = new CameraController()
    const first = new Object3D()
    const second = new Object3D()
    const cameraPosition = new Vector3(1, 2, 3)

    first.position.set(10, 0, 0)
    second.position.set(1000, 0, 0)
    c.toggleFollow(first)
    c.toggleFollow(second)

    const before = cameraPosition.clone()
    const firstUpdate = c.updateFollow(cameraPosition)

    expect(firstUpdate?.displacement.lengthSq()).toBe(0)
    expect(cameraPosition.toArray()).toEqual(before.toArray())

    second.position.add(new Vector3(5, 0, 0))
    c.updateFollow(cameraPosition)
    expect(cameraPosition.toArray()).toEqual([6, 2, 3])
  })
})
