import { Vector3 } from 'three'
import { CUBE_FACE_BASIS, directionToFaceUV, faceUVToDirection } from '@/core/renderables/BrownDwarf/cubeFaceBasis'

describe('базис граней кубмапы', () => {
  it('шесть граней, направления совпадают с осями', () => {
    const axes = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1]
    ]

    expect(CUBE_FACE_BASIS).toHaveLength(6)

    CUBE_FACE_BASIS.forEach((basis, i) => {
      expect(basis.forward.toArray()).toEqual(axes[i])
    })
  })

  it('базис ортонормирован', () => {
    for (const basis of CUBE_FACE_BASIS) {
      expect(basis.right.length()).toBeCloseTo(1)
      expect(basis.up.length()).toBeCloseTo(1)
      // Все три пары, а не две: без up·forward тест не держит собственное имя
      expect(basis.right.dot(basis.up)).toBeCloseTo(0)
      expect(basis.right.dot(basis.forward)).toBeCloseTo(0)
      expect(basis.up.dot(basis.forward)).toBeCloseTo(0)
    }
  })

  it('round-trip: направление -> (грань, u, v) -> направление', () => {
    // Независимая проверка таблицы: прямой поиск грани по главной оси
    // (правило OpenGL) и обратная реконструкция обязаны сойтись.
    // Направления обязаны покрыть все шесть веток выбора грани: баг в одной
    // ветке иначе проходит весь набор незамеченным
    const dirs = [
      new Vector3(0.3, 0.9, -0.2),
      new Vector3(-0.7, 0.1, 0.4),
      new Vector3(0.2, -0.3, 0.95),
      new Vector3(0.2, 0.3, -0.95),
      new Vector3(0.1, -0.92, 0.2),
      new Vector3(-0.5, -0.5, -0.5),
      new Vector3(1, 0.001, 0.001)
    ]

    // Тройная ничья (-0.5,-0.5,-0.5) уходит в -X по порядку сравнений —
    // это не покрытие грани, а проверка тайбрейка, поэтому граней в списке семь
    expect(new Set(dirs.map((d) => directionToFaceUV(d.clone().normalize()).face)).size).toBe(6)

    for (const dir of dirs) {
      const d = dir.clone().normalize()
      const { face, u, v } = directionToFaceUV(d)
      const back = faceUVToDirection(face, u, v)

      expect(back.x).toBeCloseTo(d.x, 6)
      expect(back.y).toBeCloseTo(d.y, 6)
      expect(back.z).toBeCloseTo(d.z, 6)
    }
  })

  it('рёбра непрерывны: общая точка двух граней даёт одно направление', () => {
    // Знаки выведены из самой таблицы, а не «по смыслу»: у +X ребро с +Z
    // лежит на u = -1, а НЕ на +1. Четыре пары граней вместо одной —
    // одна пара не отличает ошибку в знаке от ошибки в оси.
    for (const t of [-0.9, -0.3, 0, 0.4, 0.8]) {
      // +X / +Z
      expect(faceUVToDirection(0, -1, t).distanceTo(faceUVToDirection(4, 1, t))).toBeLessThan(1e-6)
      // +X / -Z
      expect(faceUVToDirection(0, 1, t).distanceTo(faceUVToDirection(5, -1, t))).toBeLessThan(1e-6)
      // +X / +Y
      expect(faceUVToDirection(0, -t, -1).distanceTo(faceUVToDirection(2, 1, t))).toBeLessThan(1e-6)
      // +Z / +Y
      expect(faceUVToDirection(4, t, -1).distanceTo(faceUVToDirection(2, t, 1))).toBeLessThan(1e-6)
    }
  })

  it('проекция не выходит за границы грани: |u| и |v| в пределах единицы', () => {
    const dirs = [
      new Vector3(0.3, 0.9, -0.2),
      new Vector3(-0.7, 0.1, 0.4),
      new Vector3(0.2, -0.3, 0.95),
      new Vector3(-0.5, -0.5, -0.5),
      new Vector3(0.6, -0.75, 0.28)
    ]

    for (const dir of dirs) {
      const { u, v } = directionToFaceUV(dir.clone().normalize())

      expect(Math.abs(u)).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})
