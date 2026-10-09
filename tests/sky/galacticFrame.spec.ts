import { describe, it, expect } from 'vitest'
import { Matrix3, Vector3 } from 'three'
import { ASTRO_TO_THREE } from '@/core/libs/frames'
import { OBLIQUITY_J2000, SCENE_TO_GALACTIC } from '@/core/sky/galacticFrame'

const DEG = Math.PI / 180

/** Единичный вектор ICRS по прямому восхождению и склонению, градусы */
function icrs(raDeg: number, decDeg: number): Vector3 {
  const ra = raDeg * DEG
  const dec = decDeg * DEG
  return new Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec))
}

/** ICRS → сцена: экватор → эклиптика (поворот вокруг X на −ε), астро → three */
function icrsToScene(v: Vector3): Vector3 {
  const c = Math.cos(OBLIQUITY_J2000)
  const s = Math.sin(OBLIQUITY_J2000)
  return new Vector3(v.x, c * v.y + s * v.z, -s * v.y + c * v.z).applyQuaternion(ASTRO_TO_THREE)
}

function galactic(scene: Vector3): Vector3 {
  return scene.clone().applyMatrix3(SCENE_TO_GALACTIC)
}

/** Галактические долгота и широта, градусы */
function lonLat(g: Vector3): [number, number] {
  return [(Math.atan2(g.y, g.x) / DEG + 360) % 360, Math.asin(g.z) / DEG]
}

describe('SCENE_TO_GALACTIC: сцена three → галактические координаты данных Брунетона', () => {
  it('собственное вращение: ортонормальна, det = +1', () => {
    const product = SCENE_TO_GALACTIC.clone().multiply(SCENE_TO_GALACTIC.clone().transpose())
    const identity = new Matrix3()
    product.elements.forEach((value, i) => expect(value).toBeCloseTo(identity.elements[i], 12))
    expect(SCENE_TO_GALACTIC.determinant()).toBeCloseTo(1, 12)
  })

  it('центр Галактики (RA 266.40499°, Dec −28.93617°) → +X', () => {
    const g = galactic(icrsToScene(icrs(266.40499, -28.93617)))
    expect(g.x).toBeCloseTo(1, 6)
    expect(g.y).toBeCloseTo(0, 5)
    expect(g.z).toBeCloseTo(0, 5)
  })

  it('северный галактический полюс (RA 192.85948°, Dec 27.12825°) → +Z', () => {
    const g = galactic(icrsToScene(icrs(192.85948, 27.12825)))
    expect(g.z).toBeCloseTo(1, 6)
  })

  it('северный полюс эклиптики — ось +Y сцены — в l 96.384°, b 29.811°', () => {
    const [l, b] = lonLat(galactic(new Vector3(0, 1, 0)))
    expect(Math.abs(l - 96.384)).toBeLessThan(0.01)
    expect(Math.abs(b - 29.811)).toBeLessThan(0.01)
  })

  it('Сириус (RA 101.28716°, Dec −16.71612°) — в l 227.230°, b −8.890°', () => {
    const [l, b] = lonLat(galactic(icrsToScene(icrs(101.28716, -16.71612))))
    expect(Math.abs(l - 227.23)).toBeLessThan(0.01)
    expect(Math.abs(b + 8.89)).toBeLessThan(0.01)
  })
})
