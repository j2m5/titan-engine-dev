import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { applyCloudView, constrainCloudCamera, CloudFlight } from '@/labs/jupiter-clouds/CloudFlight'

describe('cloud laboratory camera', () => {
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
