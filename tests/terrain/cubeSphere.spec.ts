import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { CUBE_FACES, cubeFaceDirection, TERRAIN_PATCH_DEPTH, TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'

describe('cubeFaceDirection: равноугольная развёртка куба', () => {
  it('центр каждой грани — её нормаль', () => {
    const expected = [
      new Vector3(1, 0, 0),
      new Vector3(-1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
      new Vector3(0, 0, 1),
      new Vector3(0, 0, -1)
    ]
    for (let face = 0; face < CUBE_FACES; face++) {
      const dir = cubeFaceDirection(face, 0, 0, new Vector3())
      expect(dir.distanceTo(expected[face])).toBeLessThan(1e-12)
    }
  })

  it('направления нормализованы по всей грани', () => {
    for (let face = 0; face < CUBE_FACES; face++) {
      for (let a = -1; a <= 1; a += 0.25) {
        for (let b = -1; b <= 1; b += 0.25) {
          expect(cubeFaceDirection(face, a, b, new Vector3()).length()).toBeCloseTo(1, 12)
        }
      }
    }
  })

  it('равноугольность: три равных шага по s дают три равных угла', () => {
    // у наивного normalize углы к краю грани сжимаются; equal-angle делает их равными
    const d0 = cubeFaceDirection(4, 0, 0, new Vector3())
    const d1 = cubeFaceDirection(4, 1 / 3, 0, new Vector3())
    const d2 = cubeFaceDirection(4, 2 / 3, 0, new Vector3())
    const d3 = cubeFaceDirection(4, 1, 0, new Vector3())

    const a1 = d0.angleTo(d1)
    const a2 = d1.angleTo(d2)
    const a3 = d2.angleTo(d3)
    expect(a2).toBeCloseTo(a1, 10)
    expect(a3).toBeCloseTo(a1, 10)
    // полный угол от центра до края грани — ровно π/4
    expect(d0.angleTo(d3)).toBeCloseTo(Math.PI / 4, 10)
  })

  it('кросс-граневое ребро: смежные грани дают одну и ту же точку', () => {
    // ребро +Z(s=1)/+X(s=-1): точка куба (1, t', 1) с обеих сторон
    for (let t = -1; t <= 1; t += 0.5) {
      const fromZ = cubeFaceDirection(4, 1, t, new Vector3())
      const fromX = cubeFaceDirection(0, -1, t, new Vector3())
      expect(fromZ.distanceTo(fromX)).toBeLessThan(1e-12)
    }
  })

  it('константы каркаса: глубина 3, сегментов 64', () => {
    expect(TERRAIN_PATCH_DEPTH).toBe(3)
    expect(TERRAIN_PATCH_SEGMENTS).toBe(64)
    expect(6 * 4 ** TERRAIN_PATCH_DEPTH).toBe(384)
  })
})
