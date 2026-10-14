import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { applyCloudView, constrainCloudCamera, CloudFlight } from '@/labs/jupiter-clouds/CloudFlight'

describe('cloud laboratory camera', () => {
  it('uses Earth keyboard speed, wheel speed and altitude limits without changing Jupiter defaults', () => {
    const camera = new PerspectiveCamera(), canvas = document.createElement('canvas')
    camera.position.z = 1000
    camera.lookAt(0, 0, 2000)
    const flight = new CloudFlight(camera, canvas, 6360000, { minAltitude: 100, maxAltitude: 40000000, minSpeed: 50, speedScale: 0.3, label: 'Earth flight' })
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }))
    flight.update(0.05)
    expect(camera.position.z).toBeCloseTo(1015)
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }))
    expect(camera.position.z).toBeCloseTo(1121.575)
    expect(canvas.getAttribute('aria-label')).toBe('Earth flight')
    camera.position.z = -1000
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }))
    expect(camera.position.z).toBeCloseTo(100)
    camera.position.z = 50000000
    flight.update(0.05)
    expect(camera.position.z).toBeCloseTo(40000000)
    flight.dispose()
    const old = new CloudFlight(camera, canvas, 6360000)
    camera.position.z = 1000
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }))
    old.update(0.05)
    expect(camera.position.z).toBeCloseTo(1030)
    camera.position.z = 0
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }))
    expect(camera.position.z).toBeCloseTo(500)
    old.dispose()
  })
  it.each([
    ['orbit', 90000000],
    ['above', 45000],
    ['inside', 20000],
    ['below', 5000]
  ] as const)('places the %s view at the intended altitude', (view, height) => {
    const camera = new PerspectiveCamera()
    applyCloudView(camera, view, 69911000)
    expect(camera.position.z).toBe(height)
    expect(camera.getWorldDirection(new Vector3()).length()).toBeCloseTo(1)
  })

  it('allows entry into the layer while preventing flight below the planet datum', () => {
    const camera = new PerspectiveCamera()
    camera.position.set(0, 0, -1000)
    constrainCloudCamera(camera, 69911000)
    expect(camera.position.z).toBeCloseTo(500)
    camera.position.z = 15000
    constrainCloudCamera(camera, 69911000)
    expect(camera.position.z).toBeCloseTo(15000)
  })

  it('stops accepting flight input after disposal', () => {
    const camera = new PerspectiveCamera()
    applyCloudView(camera, 'inside', 69911000)
    const canvas = document.createElement('canvas')
    const flight = new CloudFlight(camera, canvas, 69911000)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
    flight.update(0.05)
    expect(camera.position.x).toBeGreaterThan(0)
    flight.dispose()
    const before = camera.position.clone()
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
    flight.update(0.05)
    expect(camera.position.equals(before)).toBe(true)
  })
})
