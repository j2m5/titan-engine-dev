import { Matrix3, Matrix4, Vector3 } from 'three'
import { captureProjection } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorData'
import { frameBasis, createImpostorLayout, selectImpostorFrames } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'
import { asteroidSpin } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorPose'

describe('перепроекция в исходный пиксельный луч', () => {
  it('сохраняет луч после parent, instance и spin, а смесь t не сдвигает пиксель', () => {
    const parent = new Matrix4().makeRotationY(.5).multiply(new Matrix4().makeScale(2, .7, 1.2))
    parent.setPosition(0, 0, -6)
    const instance = new Matrix4().makeScale(.4, 1.7, .8)
    const spin = new Matrix4().setFromMatrix3(asteroidSpin(.47, 3600, 517))
    const transform = parent.multiply(instance).multiply(spin), inverse = transform.clone().invert()
    const origin = new Vector3().applyMatrix4(inverse)
    const ray = new Vector3(0, 0, -1).applyMatrix3(new Matrix3().setFromMatrix4(inverse))
    const layout = createImpostorLayout(8, 64), selected = selectImpostorFrames(origin, layout)
    let sum = 0, weight = 0
    for (let i = 0; i < 3; i++) {
      const hit = captureProjection(origin, ray, frameBasis(selected.frames[i], layout), 1.05, .6)
      expect(hit).not.toBeNull()
      sum += hit!.t * selected.weights[i]
      weight += selected.weights[i]
    }
    const view = origin.clone().addScaledVector(ray, sum / weight).applyMatrix4(transform)
    expect(Math.abs(view.x) + Math.abs(view.y)).toBeLessThan(1e-12)
    expect(view.z).toBeLessThan(0)
  })
})
