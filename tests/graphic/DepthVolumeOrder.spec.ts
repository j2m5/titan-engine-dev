import { describe, expect, it } from 'vitest'
import { Group, Object3D } from 'three'
import type { DepthVolume } from '@/core/graphic/passes/DepthVolume'
import { orderFarToNear } from '@/core/graphic/passes/DepthVolumePass'

class TestVolume extends Group implements DepthVolume {
  constructor(readonly boundingRadius?: number) { super() }
  bindSceneDepth(): void {}
  unbindSceneDepth(): void {}
}

const signs = Array.from({ length: 8 }, (_, mask) => ({
  x: mask & 1 ? -1 : 1, y: mask & 2 ? -1 : 1, z: mask & 4 ? -1 : 1
}))

describe('volume far-edge ordering', () => {
  for (const mode of ['direct', 'parent'] as const) {
    it.each(signs)(`${mode} reflection ($x, $y, $z) preserves the outer-to-inner order`, ({ x, y, z }) => {
      const outer = new TestVolume(1), middle = new TestVolume(2.5), inner = new TestVolume(0.5)
      const parent = new Group(), camera = new Object3D()
      parent.position.set(8, -7, 11)
      parent.rotation.set(0.2, -0.6, 0.1)
      parent.add(outer, middle, inner)
      outer.scale.set(4, 1, 1)
      if (mode === 'direct') outer.scale.set(4 * x, y, z)
      else parent.scale.set(x, y, z)
      parent.updateMatrixWorld(true)
      parent.getWorldPosition(camera.position)
      const input = [inner, middle, outer]

      expect(orderFarToNear(input, camera)).toEqual([outer, middle, inner])
      expect(input).toEqual([inner, middle, outer])
    })
  }

  it('combines the radius with world-space distance from a parented camera', () => {
    const rig = new Group(), camera = new Object3D()
    rig.position.set(10, 20, 30)
    camera.position.set(1, 2, 3)
    rig.add(camera)
    const nearLarge = new TestVolume(5), farSmall = new TestVolume(0.5), centerOnly = new TestVolume()
    nearLarge.position.set(11, 22, 34)
    farSmall.position.set(11, 22, 37)
    centerOnly.position.set(11, 22, 36)

    expect(orderFarToNear([centerOnly, farSmall, nearLarge], camera)).toEqual([nearLarge, farSmall, centerOnly])
  })

  it('uses center distance without a radius and preserves ties without changing the input', () => {
    const first = new TestVolume(), second = new TestVolume(1), third = new TestVolume(0)
    first.position.z = 2
    first.scale.set(-100, 1, 1)
    second.position.z = 1
    third.position.z = -2
    const input = [first, second, third]
    const ordered = orderFarToNear(input, new Object3D())

    expect(ordered).toEqual([first, second, third])
    expect(ordered).not.toBe(input)
    expect(input).toEqual([first, second, third])
  })
})
