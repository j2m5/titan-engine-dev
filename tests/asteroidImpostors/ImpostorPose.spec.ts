import { Matrix3, Matrix4, Vector3 } from 'three'
import { asteroidSpin, wrapAsteroidSpinTime } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorPose'
import { rockSpin } from '../asteroidBelt/rockSpinMirror'
import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'

describe('общая поза L0/L1', () => {
  it('сохраняет формулу вращения и обратное время', () => {
    for (const seed of [0.02, 0.13, 0.47, 0.81, 0.999]) {
      for (const t of [-100_000, 0, 517, 43_200]) {
        const actual = new Vector3(3, -1, 2).applyMatrix3(asteroidSpin(seed, 3600, t))
        const expected = rockSpin([3, -1, 2], seed, 3600, t)
        actual.toArray().forEach((n, i) => expect(n).toBeCloseTo(expected[i], 10))
      }
    }
  })

  it('выключается при нулевом периоде и не меняет фазу через 12P', () => {
    expect(asteroidSpin(.47, 0, 517).equals(new Matrix3())).toBe(true)
    expect(wrapAsteroidSpinTime(123, 0)).toBe(0)
    expect(wrapAsteroidSpinTime(-1, 3600)).toBe(43_199)
    const a = asteroidSpin(.47, 3600, wrapAsteroidSpinTime(-517, 3600))
    const b = asteroidSpin(.47, 3600, wrapAsteroidSpinTime(43_200 - 517, 3600))
    expect(a.equals(b)).toBe(true)
    expect(asteroidSpin(.47, 3600, 517).equals(asteroidSpin(.47, 3600, 517))).toBe(true)
  })

  it('нормаль ортогональна касательной после spin, анизотропии и матрицы родителя', () => {
    const parent = new Matrix3().setFromMatrix4(new Matrix4().makeRotationY(.7).multiply(new Matrix4().makeScale(2, 1, 3)))
    const transform = parent.multiply(new Matrix3().set(.4, 0, 0, 0, 1.7, 0, 0, 0, .8)).multiply(asteroidSpin(.47, 3600, 517))
    const n = new Vector3(1, 1, 0).normalize(), tangent = new Vector3(1, -1, 0).normalize().applyMatrix3(transform)
    expect(Math.abs(n.clone().applyMatrix3(transform.clone().invert().transpose()).normalize().dot(tangent))).toBeLessThan(1e-10)
    expect(Math.abs(n.clone().applyMatrix3(transform).normalize().dot(tangent))).toBeGreaterThan(.01)
  })

  it('L0 использует общий spin и inverse-transpose; origin не входит в seed', () => {
    const v = new InstancedAsteroidShader().vertexShader
    expect(v).toContain('asteroidSpinMatrix(shapeSeed)')
    expect(v).toContain('transpose(inverse(instanceLinear)) * spin')
    expect(v).toContain('normalMatrix * asteroidNormalMatrix(mat3(instanceMatrix), spin)')
    expect(v).toContain('shapeSeed = hash13(instanceMatrix[3].xyz)')
    expect(v).not.toMatch(/hash13\([^;]*instanceOrigin/)
  })
})
