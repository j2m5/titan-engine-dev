import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildDisplacedSphere } from '@/core/terrain/heightSampling'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

function makeMap(width: number, height: number, values: number[], minMeters = 0, maxMeters = 65535): HeightMapData {
  return { width, height, minMeters, maxMeters, data: new Uint16Array(values) }
}

const R_KM = 1736

describe('buildDisplacedSphere: честное смещение из TerrainHeightField', () => {
  it('константная карта смещает все вершины на одинаковую высоту', () => {
    const field = new TerrainHeightField(makeMap(4, 2, new Array(8).fill(65535), 0, 1000), R_KM)

    const geometry = buildDisplacedSphere(field, 8)
    const positions = geometry.getAttribute('position')
    const expected = toThreeJSUnits(R_KM + 1)

    for (let i = 0; i < positions.count; i++) {
      expect(new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).length()).toBeCloseTo(expected, 6)
    }
  })

  it('паритет с коллизией: радиус каждой вершины == surfaceRadiusUnits(dir)', () => {
    // мешер и коллизия зовут одну функцию высоты — требование роадмапа
    const values = Array.from({ length: 16 * 8 }, (_, i) => (i * 4001) % 65535)
    const field = new TerrainHeightField(makeMap(16, 8, values, -2000, 9000), R_KM)

    const geometry = buildDisplacedSphere(field, 12)
    const positions = geometry.getAttribute('position')
    const dir = new Vector3()

    for (let i = 0; i < positions.count; i++) {
      dir.set(positions.getX(i), positions.getY(i), positions.getZ(i))
      const radius = dir.length()
      dir.divideScalar(radius)
      expect(radius).toBeCloseTo(field.surfaceRadiusUnits(dir), 6)
    }
  })

  it('нормали радиальны', () => {
    const field = new TerrainHeightField(makeMap(4, 2, [0, 65535, 30000, 10000, 0, 0, 0, 0], 0, 5000), R_KM)

    const geometry = buildDisplacedSphere(field, 8)
    const positions = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')

    for (let i = 0; i < positions.count; i++) {
      const dir = new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize()
      expect(new Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)).dot(dir)).toBeCloseTo(1, 5)
    }
  })

  it('дубли полюсной вершины получают одинаковый радиус (нет полярной трещины)', () => {
    // высота у полюса по dir, а не по разъезжающимся u дублей строки полюса
    const values = Array.from({ length: 8 * 4 }, (_, i) => (i * 7919) % 65535)
    const field = new TerrainHeightField(makeMap(8, 4, values), R_KM)

    const geometry = buildDisplacedSphere(field, 8)
    const positions = geometry.getAttribute('position')

    let northRadius: number | null = null
    for (let i = 0; i < positions.count; i++) {
      const p = new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i))
      if (p.clone().normalize().y < 0.999) continue
      if (northRadius === null) northRadius = p.length()
      expect(p.length()).toBeCloseTo(northRadius, 8)
    }
    expect(northRadius).not.toBeNull()
  })
})
