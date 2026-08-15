import { describe, expect, it } from 'vitest'
import { SphereGeometry, Vector2, Vector3 } from 'three'
import { CLEARANCE_MARGIN_METERS, TerrainHeightField, terrainHeightFieldFor } from '@/core/terrain/TerrainHeightField'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

// min 0, max 65535 → метры численно равны raw-значению
function makeMap(width: number, height: number, values: number[], minMeters = 0, maxMeters = 65535): HeightMapData {
  return { width, height, minMeters, maxMeters, data: new Uint16Array(values) }
}

const R_KM = 1736

describe('TerrainHeightField: полутексельная билинейка', () => {
  it('центр текселя возвращает его высоту точно', () => {
    // 2×2, тексель (1,0)=65535 при 0..100 м; его центр — u=0.75, v=0.25
    const field = new TerrainHeightField(makeMap(2, 2, [0, 65535, 0, 0], 0, 100), R_KM)

    expect(field.sampleMeters(0.75, 0.25)).toBeCloseTo(100, 5)
    expect(field.sampleMeters(0.25, 0.25)).toBeCloseTo(0, 5)
  })

  it('между центрами интерполирует линейно', () => {
    const field = new TerrainHeightField(makeMap(2, 1, [0, 65535], 0, 100), R_KM)

    // середина между центрами текселей 0 (u=0.25) и 1 (u=0.75)
    expect(field.sampleMeters(0.5, 0.5)).toBeCloseTo(50, 2)
  })

  it('долгота заворачивается: u=0 интерполирует последний и нулевой тексели', () => {
    const field = new TerrainHeightField(makeMap(4, 1, [1000, 2000, 3000, 4000]), R_KM)

    expect(field.sampleMeters(0, 0.5)).toBeCloseTo(field.sampleMeters(1, 0.5), 5)
    // u=0 лежит между центрами текселей 3 (u=0.875) и 0 (u=0.125) ровно посередине
    expect(field.sampleMeters(0, 0.5)).toBeCloseTo((4000 + 1000) / 2, 2)
  })

  it('широта клампится: v за пределами [0,1] читает полярные строки', () => {
    const field = new TerrainHeightField(makeMap(1, 2, [5000, 9000]), R_KM)

    expect(field.sampleMeters(0, -1)).toBeCloseTo(5000, 2)
    expect(field.sampleMeters(0, 2)).toBeCloseTo(9000, 2)
  })

  it('границы min/max отдаются из заголовка', () => {
    const field = new TerrainHeightField(makeMap(2, 2, [0, 0, 0, 0], -9096.7, 10740.6), R_KM)

    expect(field.minMeters).toBeCloseTo(-9096.7, 3)
    expect(field.maxMeters).toBeCloseTo(10740.6, 3)
  })
})

describe('TerrainHeightField: паритет dirToUv с UV-развёрткой SphereGeometry', () => {
  it('для каждой вершины сферы dirToUv(позиция) совпадает с родным UV', () => {
    // Развёртка коллизии обязана совпадать с развёрткой рендера — иначе рельеф
    // коллизии разъедется с картинкой по долготе. Полюса пропускаются: там
    // three раскладывает дубли вершин по u, а направление одно.
    const geometry = new SphereGeometry(1, 16, 16)
    const positions = geometry.getAttribute('position')
    const uvs = geometry.getAttribute('uv')
    const field = new TerrainHeightField(makeMap(4, 2, [0, 0, 0, 0, 0, 0, 0, 0]), R_KM)

    const dir = new Vector3()
    const uv = new Vector2()
    let checked = 0

    for (let i = 0; i < positions.count; i++) {
      dir.set(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize()
      if (Math.abs(dir.y) > 0.999) continue

      field.dirToUv(dir, uv)

      // u на шве: 0 и 1 эквивалентны
      const du = Math.abs(uv.x - uvs.getX(i))
      expect(Math.min(du, 1 - du)).toBeLessThan(1e-6)
      // v карты: 0 = север = uv.y 1 у SphereGeometry
      expect(uv.y).toBeCloseTo(1 - uvs.getY(i), 6)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
  })
})

describe('TerrainHeightField: высоты по направлению', () => {
  it('surfaceRadiusUnits = юниты(R + h)', () => {
    // константная карта: raw 65535 при 0..1000 м → h = 1 км всюду
    const field = new TerrainHeightField(makeMap(4, 2, new Array(8).fill(65535), 0, 1000), R_KM)

    const dir = new Vector3(1, 1, 1).normalize()
    expect(field.surfaceRadiusUnits(dir)).toBeCloseTo(toThreeJSUnits(R_KM + 1), 10)
  })
})

describe('TerrainHeightField: нормаль поверхности', () => {
  it('на склоне, растущем к северу, нормаль отклонена к югу', () => {
    // строки: север выше юга (метры = raw)
    const values = [
      ...new Array(8).fill(60000),
      ...new Array(8).fill(40000),
      ...new Array(8).fill(20000),
      ...new Array(8).fill(0)
    ]
    const field = new TerrainHeightField(makeMap(8, 4, values), R_KM)

    const dir = new Vector3(1, 0, 0)
    const normal = field.surfaceNormalLocal(dir, new Vector3())

    const east = new Vector3(0, 1, 0).cross(dir).normalize()
    const north = dir.clone().cross(east)
    expect(normal.dot(north)).toBeLessThan(0)
    expect(normal.dot(dir)).toBeGreaterThan(0.5)
    expect(normal.length()).toBeCloseTo(1, 6)
  })

  it('у полюса нормаль радиальная (базис вырожден)', () => {
    const field = new TerrainHeightField(makeMap(8, 4, new Array(32).fill(1000)), R_KM)
    const normal = field.surfaceNormalLocal(new Vector3(0, 1, 0), new Vector3())

    expect(normal.y).toBeCloseTo(1, 6)
  })
})

describe('terrainHeightFieldFor: кэш', () => {
  it('одна карта — один экземпляр', () => {
    const map = makeMap(2, 2, [0, 0, 0, 0])

    expect(terrainHeightFieldFor(map, R_KM)).toBe(terrainHeightFieldFor(map, R_KM))
  })
})

describe('TerrainHeightField: карта провиса', () => {
  // обратная формула dirToUv (задача 1): theta = v·π, север v=0 → +Y
  const uvToDir = (u: number, v: number): Vector3 => {
    const theta = v * Math.PI
    const phi = u * 2 * Math.PI
    return new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
  }

  it('плоская карта даёт ровный минимальный клиренс', () => {
    const field = new TerrainHeightField(makeMap(64, 32, new Array(64 * 32).fill(30000), 0, 20000), R_KM)

    const dirs = [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(1, 1, 1).normalize()]
    for (const dir of dirs) {
      expect(field.clearanceMeters(dir)).toBeCloseTo(CLEARANCE_MARGIN_METERS, 5)
    }
    expect(field.maxClearanceMeters).toBeCloseTo(CLEARANCE_MARGIN_METERS, 5)
  })

  it('одиночная яма поднимает клиренс в своей ячейке и соседних, дальние не трогает', () => {
    // 64×32, min 0 max 65535 (метры = raw): яма глубиной 10000 в одном текселе
    const values = new Array(64 * 32).fill(20000)
    values[16 * 64 + 8] = 10000 // строка 16, столбец 8
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    // направление в яму: столбец 8 → u = 8.5/64, строка 16 → v = 16.5/32
    expect(field.clearanceMeters(uvToDir(8.5 / 64, 16.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // противоположная сторона планеты — только базовый запас
    expect(field.clearanceMeters(uvToDir(40.5 / 64, 16.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
    expect(field.maxClearanceMeters).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
  })

  it('collisionRadiusUnits = поверхность + клиренс в юнитах', () => {
    const field = new TerrainHeightField(makeMap(4, 2, new Array(8).fill(65535), 0, 1000), R_KM)

    const dir = new Vector3(1, 0, 0)
    expect(field.collisionRadiusUnits(dir)).toBeCloseTo(
      field.surfaceRadiusUnits(dir) + toThreeJSUnits(CLEARANCE_MARGIN_METERS / 1000),
      12
    )
  })

  it('крупная карта (block > 1) сводит яму через блочную редукцию', () => {
    // 2048×1024 → block = round(2048/1024) = 2, блоки объединяют по 2 текселя:
    // проверяем, что редукция по блокам, а не только по-текселная, находит яму
    const width = 2048
    const height = 1024
    const values = new Array(width * height).fill(20000)
    const col = 512
    const row = 256
    values[row * width + col] = 10000
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    const pitDir = uvToDir((col + 0.5) / width, (row + 0.5) / height)
    expect(field.clearanceMeters(pitDir)).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)

    // противоположная долгота на том же широтном поясе — вне окрестности ямы
    const farCol = (col + width / 2) % width
    const farDir = uvToDir((farCol + 0.5) / width, (row + 0.5) / height)
    expect(field.clearanceMeters(farDir)).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
  })

  it('яма у шва долготы (столбец 0) поднимает клиренс у правого края карты', () => {
    // 64×32, block=1: яма в столбце 0 — группа 2×2 и дилатация заворачивают
    // индекс через шов (bx=63 → (63+1)%64=0), клиренс должен вырасти и справа
    const values = new Array(64 * 32).fill(20000)
    values[16 * 64 + 0] = 10000 // строка 16, столбец 0 — у самого шва
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    // правый край карты, u чуть меньше 1 — последний столбец, ячейка 7 из 8
    expect(field.clearanceMeters(uvToDir(63.5 / 64, 16.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // середина карты — вне окрестности шва и ямы
    expect(field.clearanceMeters(uvToDir(32.5 / 64, 16.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
  })

  it('полярная яма (строка 0) считается без падения и не течёт на другой полюс', () => {
    // 64×32, block=1: яма в строке 0 (у полюса) — широта должна клемпиться,
    // а не заворачиваться на противоположный полюс
    const values = new Array(64 * 32).fill(20000)
    values[0 * 64 + 32] = 10000 // строка 0, столбец 32
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    expect(field.clearanceMeters(uvToDir(32.5 / 64, 0.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // противоположный полюс — только базовый запас, клампа не должно перетекать
    expect(field.clearanceMeters(uvToDir(32.5 / 64, 31.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
  })
})
