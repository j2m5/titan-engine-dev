import { describe, it, expect, vi } from 'vitest'
import { CameraController } from '@/core/camera/CameraController'

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
})
