import { describe, expect, it } from 'vitest'
import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three'
import {
  FREE_LOOK_MAX_PITCH,
  freeLookRotate,
  isFreeLook,
  orbitAngleScale
} from '@/core/libs/surfaceCamera'

const UP = new Vector3(0, 1, 0)

function forwardOf(q: Quaternion): Vector3 {
  return new Vector3(0, 0, -1).applyQuaternion(q)
}

function rightOf(q: Quaternion): Vector3 {
  return new Vector3(1, 0, 0).applyQuaternion(q)
}

/** Ориентация «смотрит по forward, верх кадра — к up», как lookAt. */
function looking(forward: Vector3, up: Vector3 = UP): Quaternion {
  return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), forward, up))
}

describe('orbitAngleScale: доля угла орбиты от высоты', () => {
  it('далеко от тела — почти 1, у поверхности — h/(h+R)', () => {
    expect(orbitAngleScale(1e9, 1)).toBeCloseTo(1, 6)
    expect(orbitAngleScale(2, 1737)).toBeCloseTo(2 / 1739, 12)
  })

  it('высота ≤ 0 (камера на полу) — ноль, не отрицательное', () => {
    expect(orbitAngleScale(-1, 1737)).toBe(0)
  })
})

describe('isFreeLook: осмотр на месте ниже доли радиуса', () => {
  it('ниже порога — да, выше — нет', () => {
    expect(isFreeLook(30, 1737, 0.02)).toBe(true)
    expect(isFreeLook(40, 1737, 0.02)).toBe(false)
  })
})

describe('freeLookRotate: взгляд на месте с ровным горизонтом', () => {
  const W = 1000
  const H = 500

  it('рыскание вокруг местной вертикали: горизонт остаётся ровным (правая ось ⟂ вертикали)', () => {
    const q = looking(new Vector3(1, 0, 0))
    freeLookRotate(q, UP, 100, 0, W, H)
    expect(rightOf(q).dot(UP)).toBeCloseTo(0, 9)
    // мышь вправо — взгляд вправо: смотря по +X с верхом +Y, правая рука — +Z
    const f = forwardOf(q)
    expect(f.y).toBeCloseTo(0, 9)
    expect(f.z).toBeGreaterThan(0)
  })

  it('180° на ширину окна по горизонтали', () => {
    const q = looking(new Vector3(1, 0, 0))
    freeLookRotate(q, UP, W, 0, W, H)
    expect(forwardOf(q).x).toBeCloseTo(-1, 9)
  })

  it('мышь вверх — взгляд вверх; тангаж зажат ±89°, NaN нет', () => {
    const q = looking(new Vector3(1, 0, 0))
    freeLookRotate(q, UP, 0, -H / 4, W, H) // 22.5° вверх
    expect(MathUtils.radToDeg(Math.asin(forwardOf(q).dot(UP)))).toBeCloseTo(22.5, 6)
    freeLookRotate(q, UP, 0, -10 * H, W, H)
    expect(Math.asin(forwardOf(q).dot(UP))).toBeCloseTo(FREE_LOOK_MAX_PITCH, 9)
    expect(rightOf(q).dot(UP)).toBeCloseTo(0, 9)
  })

  it('из взгляда строго вниз (после орбиты) мышь вверх поднимает взгляд к горизонту в сторону верха кадра', () => {
    // смотрит в центр тела, верх кадра — к +X
    const q = looking(new Vector3(0, -1, 0), new Vector3(1, 0, 0))
    freeLookRotate(q, UP, 0, -H, W, H) // 90° вверх
    const f = forwardOf(q)
    expect(Number.isFinite(f.x)).toBe(true)
    expect(f.x).toBeGreaterThan(0.99)
    expect(rightOf(q).dot(UP)).toBeCloseTo(0, 9)
  })
})
