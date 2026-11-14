import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import {
  BoulderShadowFrame,
  BOULDER_SHADOW_WIDTH_METERS,
  BOULDER_SHADOW_SIZE,
  BOULDER_SHADOW_DEPTH_METERS
} from '@/core/terrain/boulderShadowFrame'
import { toThreeJSUnits } from '@/core/helpers/scaling'

const unit = toThreeJSUnits(0.001)
describe('local boulder shadow frame', () => {
  it('snaps the light plane to full texels and preserves it below half a texel', () => {
    const frame = new BoulderShadowFrame(),
      texel = (BOULDER_SHADOW_WIDTH_METERS * unit) / BOULDER_SHADOW_SIZE
    const camera = new Vector3(123 * texel, -456 * texel, 1.7),
      sun = new Vector3(0, 0, 1)
    expect(frame.update(camera, sun)).toBe(true)
    const origin = frame.origin.clone()
    frame.update(camera.clone().add(new Vector3(0.49 * texel, -0.49 * texel, 0)), sun)
    expect(frame.origin.distanceTo(origin)).toBeLessThan(1e-12)
    frame.update(camera.clone().add(new Vector3(0.51 * texel, 0, 0)), sun)
    expect(frame.origin.x - origin.x).toBeCloseTo(texel, 12)
  })

  it('projects receivers identically from different cameras at astronomical translations', () => {
    const frame = new BoulderShadowFrame(),
      local = new Vector3(0.4235, -1.1417, 1.1871)
    frame.update(local, new Vector3(0.3, 0.8, -0.4))
    const host = new Matrix4().compose(
      new Vector3(103964, -2570, 1195),
      new Quaternion().setFromEuler(new Euler(0.4, -0.8, 0.2)),
      new Vector3(1, 1, 1)
    )
    const point = local.clone().add(new Vector3(20, -50, 80).multiplyScalar(unit))
    const expected = point.clone().sub(frame.origin).applyMatrix4(frame.relativeToShadow)
    for (const offset of [new Vector3(0, 0, 0), new Vector3(40, -20, 80).multiplyScalar(unit)]) {
      const camera = new Matrix4().compose(
        local.clone().add(offset),
        new Quaternion().setFromEuler(new Euler(-0.2, 1.1, 0.5)),
        new Vector3(1, 1, 1)
      )
      const worldCamera = host.clone().multiply(camera)
      const viewPoint = point.clone().applyMatrix4(host).applyMatrix4(worldCamera.clone().invert())
      const projected = viewPoint.applyMatrix4(frame.viewToShadow(host, worldCamera, new Matrix4()))
      expect(projected.distanceTo(expected)).toBeLessThan(1e-7)
    }
  })

  it('orders casters towards the sun before the ground in linear depth', () => {
    const frame = new BoulderShadowFrame(),
      sun = new Vector3(0.3, 0.8, -0.4).normalize()
    frame.update(new Vector3(0, 1.7, 0), sun)
    const ground = new Vector3().applyMatrix4(frame.relativeToShadow)
    const rock = sun
      .clone()
      .multiplyScalar(10 * unit)
      .applyMatrix4(frame.relativeToShadow)
    expect(ground.toArray()).toEqual([0.5, 0.5, 0.5])
    expect(ground.z - rock.z).toBeCloseTo(10 / BOULDER_SHADOW_DEPTH_METERS, 12)
  })

  it('keeps a finite orthonormal basis at the poles and rejects invalid light', () => {
    const frame = new BoulderShadowFrame()
    for (const sun of [new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(1e-12, 1, 1e-12)]) {
      expect(frame.update(new Vector3(0, 1.7, 0), sun)).toBe(true)
      expect(frame.right.length()).toBeCloseTo(1)
      expect(frame.up.length()).toBeCloseTo(1)
      expect(Math.abs(frame.right.dot(frame.up))).toBeLessThan(1e-10)
      expect(frame.relativeToShadow.elements.every(Number.isFinite)).toBe(true)
    }
    expect(frame.update(new Vector3(0, 1.7, 0), new Vector3())).toBe(false)
    expect(frame.update(new Vector3(NaN, 0, 0), new Vector3(1, 0, 0))).toBe(false)
  })
})
