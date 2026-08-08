import { Vector3 } from 'three'
import { bdFlowChunk } from '@/core/renderables/BrownDwarf/BrownDwarfBakeShaders'
import { bdEast, bdFlow } from './brownDwarfFlowMirror'

const SAMPLES: Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(0, 0, 1),
  new Vector3(0.3, 0.5, -0.8).normalize(),
  new Vector3(-0.6, -0.2, 0.77).normalize(),
  new Vector3(0.05, 0.99, 0.05).normalize()
]

describe('поле потока запекания', () => {
  it('касательно к сфере: снос не уводит точку с единичной сферы', () => {
    for (const dir of SAMPLES) {
      const flow = bdFlow(dir, 9, 0.6, 1.6, 4096)

      expect(Math.abs(flow.dot(dir))).toBeLessThan(1e-6)
    }
  })

  it('на полюсах не даёт NaN', () => {
    // cross(Y, ±Y) вырождается в ноль: защита обязана стоять ДО нормализации
    for (const pole of [new Vector3(0, 1, 0), new Vector3(0, -1, 0)]) {
      expect(bdEast(pole).length()).toBe(0)

      const flow = bdFlow(pole, 9, 0.6, 1.6, 4096)

      expect(Number.isFinite(flow.x)).toBe(true)
      expect(Number.isFinite(flow.y)).toBe(true)
      expect(Number.isFinite(flow.z)).toBe(true)
    }
  })

  it('струи меняют знак от пояса к поясу', () => {
    // Сдвиг между соседними струями и растягивает поле вдоль пояса.
    //
    // Широты выводятся ИЗ bandCount, а не подобраны: центр пояса номер n
    // лежит на y = (n + 0.5) / bandCount, где sin(y·PI·bandCount) равен
    // ровно ∓1. Знаки максимально разнесены, а не сидят на грани нуля, и
    // правка bandCount не роняет тест молча.
    //
    // Ловушка: строить направление через normalize(0.1, y, 0) нельзя —
    // нормализация утащит y почти к полюсу (0.3 превращается в 0.95),
    // и обе точки окажутся в одном поясе. Здесь вектор единичный сразу.
    const bandCount = 9
    const bandCenter = (band: number): Vector3 => {
      const y: number = (band + 0.5) / bandCount

      return new Vector3(Math.sqrt(1 - y * y), y, 0)
    }

    // turbulence = 0 отключает вихри: остаются только струи
    const north = bdFlow(bandCenter(1), bandCount, 0.6, 0, 0)
    const south = bdFlow(bandCenter(2), bandCount, 0.6, 0, 0)

    expect(Math.sign(north.z) * Math.sign(south.z)).toBe(-1)
  })

  it('чанк объявляет обе части потока и защиту полюса', () => {
    expect(bdFlowChunk).toContain('vec3 bdEast(')
    expect(bdFlowChunk).toContain('vec3 bdFlow(')
    expect(bdFlowChunk).toContain('cross(dir,')
    // Защита полюса обязана быть в тексте: без неё normalize даёт NaN
    expect(bdFlowChunk).toContain('POLE_EPSILON')
  })
})
