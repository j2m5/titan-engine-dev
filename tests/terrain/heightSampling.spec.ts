import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildDisplacedSphere, sampleHeightMeters } from '@/core/terrain/heightSampling'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

function makeMap(width: number, height: number, values: number[], minMeters = 0, maxMeters = 65535): HeightMapData {
  return { width, height, minMeters, maxMeters, data: new Uint16Array(values) }
}

describe('sampleHeightMeters: билинейная выборка', () => {
  it('точное попадание в тексель возвращает его высоту в метрах', () => {
    // 2×2, min 0 max 100: raw 65535 → 100 м
    const map = makeMap(2, 2, [0, 65535, 0, 0], 0, 100)

    expect(sampleHeightMeters(map, 0.5, 0)).toBeCloseTo(100, 5)
    expect(sampleHeightMeters(map, 0, 0)).toBeCloseTo(0, 5)
  })

  it('долгота заворачивается: u=1 читает тот же тексель, что u=0', () => {
    const map = makeMap(4, 1, [1000, 2000, 3000, 4000])

    expect(sampleHeightMeters(map, 1, 0)).toBeCloseTo(sampleHeightMeters(map, 0, 0), 5)
    expect(sampleHeightMeters(map, -0.25, 0)).toBeCloseTo(sampleHeightMeters(map, 0.75, 0), 5)
  })

  it('широта клампится: v за пределами [0,1] читает полярные строки', () => {
    const map = makeMap(1, 2, [5000, 9000])

    expect(sampleHeightMeters(map, 0, -1)).toBeCloseTo(sampleHeightMeters(map, 0, 0), 5)
    expect(sampleHeightMeters(map, 0, 2)).toBeCloseTo(sampleHeightMeters(map, 0, 1), 5)
  })

  it('между текселями интерполирует линейно', () => {
    const map = makeMap(2, 1, [0, 65535], 0, 100)

    // середина между колонками 0 и 1; точность 2: квантование Uint16 даёт 49.9992
    expect(sampleHeightMeters(map, 0.25, 0)).toBeCloseTo(50, 2)
  })
})

describe('buildDisplacedSphere: честное смещение', () => {
  const R = toThreeJSUnits(1736)

  it('константная карта смещает все вершины на одинаковую высоту', () => {
    // все значения 65535 при диапазоне 0..1000 м → +1 км над радиусом
    const map = makeMap(4, 2, new Array(8).fill(65535), 0, 1000)

    const geometry = buildDisplacedSphere(R, map, 8)
    const positions = geometry.getAttribute('position')
    const expected = R + toThreeJSUnits(1)

    for (let i = 0; i < positions.count; i++) {
      const length = new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).length()
      expect(length).toBeCloseTo(expected, 6)
    }
  })

  it('нормали на константной карте радиальны', () => {
    const map = makeMap(4, 2, new Array(8).fill(30000), 0, 1000)

    const geometry = buildDisplacedSphere(R, map, 8)
    const positions = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')

    for (let i = 0; i < positions.count; i++) {
      const dir = new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize()
      const normal = new Vector3(normals.getX(i), normals.getY(i), normals.getZ(i))
      expect(normal.dot(dir)).toBeCloseTo(1, 5)
    }
  })

  it('на склоне, растущем к северу, нормаль экваториальной вершины наклонена к югу', () => {
    // строка 0 (север) выше строки 1 (юг): градиент к северу положителен
    const map = makeMap(8, 4, [
      ...new Array(8).fill(60000),
      ...new Array(8).fill(40000),
      ...new Array(8).fill(20000),
      ...new Array(8).fill(0)
    ], 0, 200000)

    const geometry = buildDisplacedSphere(R, map, 16)
    const positions = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')

    // ищем вершину у экватора (|y| мал относительно радиуса)
    let checked = 0
    for (let i = 0; i < positions.count; i++) {
      const position = new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i))
      if (Math.abs(position.y) > R * 0.2) continue

      const dir = position.clone().normalize()
      const east = new Vector3(0, 1, 0).cross(dir).normalize()
      const north = dir.clone().cross(east)
      const normal = new Vector3(normals.getX(i), normals.getY(i), normals.getZ(i))

      // нормаль отклоняется прочь от подъёма — к югу
      expect(normal.dot(north)).toBeLessThan(0)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('полярные вершины не дают NaN', () => {
    const map = makeMap(4, 2, [0, 65535, 30000, 10000], 0, 5000)

    const geometry = buildDisplacedSphere(R, map, 8)
    const normals = geometry.getAttribute('normal')

    for (let i = 0; i < normals.count; i++) {
      expect(Number.isNaN(normals.getX(i))).toBe(false)
      expect(Number.isNaN(normals.getY(i))).toBe(false)
      expect(Number.isNaN(normals.getZ(i))).toBe(false)
    }
  })
})
