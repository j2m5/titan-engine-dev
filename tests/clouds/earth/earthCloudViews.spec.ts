import { expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { applyEarthCloudView } from '@/labs/earth-clouds/earthCloudViews'
it.each([['orbit', 20000000], ['approach', 110000], ['above', 12000], ['inside', 6000], ['below', 2000]] as const)('sets the Earth %s view', (view, height) => {
  const camera = new PerspectiveCamera()
  applyEarthCloudView(camera, view, 6360000)
  expect(camera.position.z).toBe(height)
  expect(camera.matrixWorld.elements.every(Number.isFinite)).toBe(true)
  expect(camera.quaternion.length()).toBeCloseTo(1)
})
