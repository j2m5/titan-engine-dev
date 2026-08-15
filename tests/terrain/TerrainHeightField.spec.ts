import { describe, expect, it } from 'vitest'
import { SphereGeometry, Vector2, Vector3 } from 'three'
import {
  CLEARANCE_MARGIN_METERS,
  TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS,
  TerrainHeightField,
  terrainHeightFieldFor
} from '@/core/terrain/TerrainHeightField'
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

describe('TerrainHeightField: шов x=width при f64-округлении', () => {
  it('u на 1 ULP левее центра текселя 0 не даёт NaN и совпадает с sampleMeters(0.125, 0.5)', () => {
    // width=4: x = frac(u)·4 − 0.5 даёт крошечный минус, x += width округляется
    // в f64 РОВНО до 4.0 (не 4−ε) — floor(4.0)=4, вне [0, width−1]. 0.125 — центр
    // текселя 0; u ниже на 1 ULP double — тот же тексель по смыслу.
    const buggyU = 0.12499999999999999
    expect(buggyU).not.toBe(0.125) // соседний, но различимый double
    const field = new TerrainHeightField(makeMap(4, 1, [100, 200, 300, 400]), R_KM)

    expect(Number.isNaN(field.sampleMeters(buggyU, 0.5))).toBe(false)
    expect(field.sampleMeters(buggyU, 0.5)).toBeCloseTo(field.sampleMeters(0.125, 0.5), 5)
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
    // 64×32, min 0 max 65535 (метры = raw): яма глубиной 10000 в одном текселе.
    // block=1 (64 < TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS), CLEARANCE_CELL_BLOCKS=1 ⇒ ячейка
    // = 1 блок = 1 тексель. Яма в (col8,row16) поднимает sag только у групп
    // 2×2 с началом bx∈{7,8}, by∈{15,16}; финальная дилатация 3×3 растягивает
    // это ещё на ±1 ячейку — весь поднятый остров укладывается в x∈[6,9], y∈[14,17]
    const values = new Array(64 * 32).fill(20000)
    values[16 * 64 + 8] = 10000 // строка 16, столбец 8
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    // направление в яму: столбец 8 → u = 8.5/64, строка 16 → v = 16.5/32
    expect(field.clearanceMeters(uvToDir(8.5 / 64, 16.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // столбец 10 лежал в СТАРОЙ 8-блочной ячейке ямы (колонки 8..15) — при
    // сузившейся до 1 блока сетке он вне поднятого острова (x∈[6,9]):
    // демонстрация того, что клиренс перестал завышаться на весь бывший блок
    expect(field.clearanceMeters(uvToDir(10.5 / 64, 16.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
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
    // width = 1.5×TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS → block = round(1.5) = 2,
    // блоки объединяют по 2 текселя: проверяем, что редукция по блокам, а не
    // только по-текселная, находит яму. Высота карты урезана против реальной
    // (не 1:2 к ширине) — тестам провиса высота не важна, важен только счёт
    // блоков по X, а полный 1:2 сделал бы фикстуру неоправданно тяжёлой.
    const width = TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS * 1.5
    const height = 128
    const values = new Array(width * height).fill(20000)
    const col = width / 4
    const row = height / 4
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
    // 64×32, block=1, CLEARANCE_CELL_BLOCKS=1 (ячейка = блок = тексель): яма
    // в столбце 0 — группа 2×2 с началом bx=63 заворачивает индекс через шов
    // ((63+1)%64=0) и включает яму напрямую, дилатация 3×3 растягивает
    // поднятый остров до x∈{62,63,0,1}
    const values = new Array(64 * 32).fill(20000)
    values[16 * 64 + 0] = 10000 // строка 16, столбец 0 — у самого шва
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    // последний блок сетки (столбец 63) заворачивает через шов вместе с ямой
    expect(field.clearanceMeters(uvToDir(63.5 / 64, 16.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // столбец 61 лежал в СТАРОЙ 8-блочной ячейке шва (56..63), но новый
    // остров у шва (x∈{62,63,0,1}) его не накрывает — только базовый запас
    expect(field.clearanceMeters(uvToDir(61.5 / 64, 16.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
    // середина карты — вне окрестности шва и ямы
    expect(field.clearanceMeters(uvToDir(32.5 / 64, 16.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
  })

  it('полярная яма (строка 0) считается без падения и не течёт на другой полюс', () => {
    // 64×32, block=1: яма в строке 0 (у полюса) — широта должна клемпиться,
    // а не заворачиваться на противоположный полюс. Клампованные группы
    // 2×2 включают яму только при by=0 (нет группы «by=-1»), дилатация 3×3
    // растягивает поднятый остров до y∈{0,1}
    const values = new Array(64 * 32).fill(20000)
    values[0 * 64 + 32] = 10000 // строка 0, столбец 32
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    expect(field.clearanceMeters(uvToDir(32.5 / 64, 0.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // строка 2 лежала в СТАРОЙ 8-блочной полярной ячейке (0..7) — новая
    // сетка её не накрывает (остров лишь y∈{0,1}): только базовый запас
    expect(field.clearanceMeters(uvToDir(32.5 / 64, 2.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
    // противоположный полюс — только базовый запас, клампа не должно перетекать
    expect(field.clearanceMeters(uvToDir(32.5 / 64, 31.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
  })
})

describe('TerrainHeightField: окно провиса меряет фактическую сетку квадродерева, не удалённую монолитную сферу этапа 2', () => {
  const uvToDir = (u: number, v: number): Vector3 => {
    const theta = v * Math.PI
    const phi = u * 2 * Math.PI
    return new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
  }

  it('на карте лунного разрешения клиренс в 12 текселях от ямы — только базовый запас (окно узкое, не старое 8-блочное)', () => {
    // 8192×64, block=1 под новым окном (max-level квадродерева), а под ДАВНО
    // СНЕСЁННОЙ монолитной сеткой этапа 2 (TERRAIN_SPHERE_SEGMENTS=1024) был бы
    // block=round(8192/1024)=8 — группа (1+span)×2 блоков плюс дилатация 3×3
    // дотягивались на ±15/+... текселей от ямы (в блоках по 8 текселей) и
    // завышали клиренс на десятки текселей вокруг. Новое окно (block=1) держит
    // зону влияния в ±2 текселя (группа) + дилатация 1 ячейка = офсет 12 текселей
    // уже вне неё — только базовый запас. Строка 28 — около экватора (cosLat≈0.98,
    // span=1), без полярного раздутия окна, чистая проверка долготного радиуса.
    const width = 8192
    const height = 64
    const values = new Array(width * height).fill(20000)
    const pitCol = 4096
    const pitRow = 28
    values[pitRow * width + pitCol] = 10000 // яма 10000 м глубиной
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    const probeClearance = field.clearanceMeters(
      uvToDir((pitCol + 12.5) / width, (pitRow + 0.5) / height)
    )

    expect(probeClearance).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
  })

  it('maxClearanceMeters на той же карте — метры, а не километры (яма целиком в её собственной узкой ячейке)', () => {
    const width = 8192
    const height = 64
    const values = new Array(width * height).fill(20000)
    values[28 * width + 4096] = 10000
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    expect(field.maxClearanceMeters).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
  })
})

describe('TerrainHeightField: окно провиса расширяется к полюсу как 1/cos', () => {
  const uvToDir = (u: number, v: number): Vector3 => {
    const theta = v * Math.PI
    const phi = u * 2 * Math.PI
    return new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
  }

  it('провал в высокоширотной строке (строка 0, |lat|≈87°) ловится клиренсом за пределами старого фиксированного окна', () => {
    // 64×32: центр строки 0 — theta = π·0.5/32 ≈ 2.81°, cosLat = sin(theta) ≈
    // 0.0491, round(1/cosLat) = 20, капается до floor(blocksX/4) = 16 — окно
    // группировки растёт с фиксированных 2 колонок до 17 (0..16). Патч
    // кубосферы у этой широты накрывает по долготе кратно больше колонок,
    // чем у экватора (см. surfaceNormalLocal) — окно провиса обязано расти синхронно.
    const values = new Array(64 * 32).fill(20000)
    values[0 * 64 + 25] = 10000 // строка 0, столбец 25 — яма в 15 колонках от зонда
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    // зонд в столбце 10: разнесение 15 колонок — старое фиксированное окно (2
    // соседние колонки) яму не видит, новое 1/cos-окно (до 16 колонок на этой
    // широте) её накрывает
    expect(field.clearanceMeters(uvToDir(10.5 / 64, 0.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
  })

  it('регрессия: экваториальный провис не меняется расширением окна у полюса', () => {
    // тот же сдвиг 15 колонок, но строка 16 = экватор (cosLat≈1, span=1 как и
    // до фикса) — окно НЕ расширяется, яма вне зоны видимости зонда
    const values = new Array(64 * 32).fill(20000)
    values[16 * 64 + 25] = 10000
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    expect(field.clearanceMeters(uvToDir(10.5 / 64, 16.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
  })
})

describe('TerrainHeightField: билинейная выборка клиренса', () => {
  const uvToDir = (u: number, v: number): Vector3 => {
    const theta = v * Math.PI
    const phi = u * 2 * Math.PI
    return new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
  }

  it('на центре ячейки — точное значение, между центрами — монотонная интерполяция', () => {
    // 8×2 (обе строки одинаковы — широта не участвует), h(x) = x²·1000:
    // own-sag группы 2×2 с началом bx = h(bx+1)−h(bx) растёт с bx, финальная
    // дилатация 3×3 берёт максимум окна ⇒ у ячеек 1..5 (вдали от шва, где
    // дилатация не подмешивает большой скачок обёртки h(7)→h(0)) сетка
    // получает чистый монотонно растущий ряд: cell(cx) = h(cx+2) − h(cx+1)
    const h = [0, 1000, 4000, 9000, 16000, 25000, 36000, 49000] // x²·1000
    const values = [...h, ...h]
    const field = new TerrainHeightField(makeMap(8, 2, values, 0, 65535), R_KM)

    const gridAt = (cx: number): number => field.clearanceMeters(uvToDir((cx + 0.5) / 8, 0.5))

    const c2 = gridAt(2) // h(4)-h(3) = 16000-9000 = 7000 (+margin)
    const c3 = gridAt(3) // h(5)-h(4) = 25000-16000 = 9000 (+margin)
    expect(c2).toBeCloseTo(7000 + CLEARANCE_MARGIN_METERS, 6)
    expect(c3).toBeCloseTo(9000 + CLEARANCE_MARGIN_METERS, 6)

    // ровно между центрами ячеек 2 и 3 — точное среднее (fx=0.5)
    const mid = field.clearanceMeters(uvToDir((2.5 + 3.5) / 2 / 8, 0.5))
    expect(mid).toBeCloseTo((c2 + c3) / 2, 6)

    // монотонность: четверть пути от c2 к c3 лежит строго между ними
    const quarter = field.clearanceMeters(uvToDir((2.5 + (3.5 - 2.5) * 0.25) / 8, 0.5))
    expect(quarter).toBeGreaterThan(c2)
    expect(quarter).toBeLessThan(mid)
  })
})

describe('TerrainHeightField: геометрическая ошибка уровня', () => {
  it('монотонно не возрастает с уровнем и положительна', () => {
    const values = Array.from({ length: 64 * 32 }, (_, k) => (k * 4001) % 65535)
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    let prev = Infinity
    for (let level = 1; level <= 6; level++) {
      const e = field.geometricErrorMeters(level)
      expect(e).toBeGreaterThan(0)
      expect(e).toBeLessThanOrEqual(prev)
      prev = e
    }
  })

  it('консервативность: ε уровня ≥ p50 фактического размаха на шаге сетки (синтетика)', () => {
    // шахматка амплитудой 1000 м на масштабе блока: размах любого окна = 1000
    const width = 64
    const height = 32
    const values = new Array(width * height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) values[y * width + x] = ((x + y) % 2) * 1000
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    // блок=1 тексель: окно 1×1 не видит соседа — консервативность держит окно 2×2 у ℓ1
    expect(field.geometricErrorMeters(1)).toBeCloseTo(1000, 0)
  })

  it('одиночный обрыв не задирает p99', () => {
    const width = 64
    const height = 32
    const values = new Array(width * height).fill(20000)
    values[16 * width + 8] = 0 // одна яма 20 км
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    // p99: 99% окон плоские → ε мала против глубины ямы
    expect(field.geometricErrorMeters(2)).toBeLessThan(2000)
  })

  it('level клампится в [1..6]', () => {
    const field = new TerrainHeightField(makeMap(4, 2, new Array(8).fill(0)), R_KM)
    expect(field.geometricErrorMeters(0)).toBe(field.geometricErrorMeters(1))
    expect(field.geometricErrorMeters(9)).toBe(field.geometricErrorMeters(6))
  })

  it('block > 1: фолбэк на p99(2×2) не срабатывает — ℓ2 равен именно p99(1×1)', () => {
    // width = 1.5×TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS → block=round(1.5)=2 (как
    // в clearance-тесте «крупная карта»). Внутриблочный размах = R1 у КАЖДОГО
    // блока (не зависит от bx/by) — p99(1×1)=R1 точно. Базовая высота блока
    // растёт с bx на шаг S — окно 2×2 захватывает соседний блок выше на S,
    // p99(2×2)=S+R1 строго больше p99(1×1): различие само по себе доказывает,
    // что ℓ2 не подменился фолбэком на p99(2×2). Высота урезана против
    // реальной 1:2 к ширине — тестам ε-пирамиды высота не важна, важен только
    // счёт блоков по X, полный 1:2 сделал бы фикстуру неоправданно тяжёлой.
    const width = TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS * 1.5
    const height = 128
    const block = 2
    const blocksX = width / block
    const blocksY = height / block
    // S мал: значения — raw Uint16, а blocksX теперь 12288 (вместо 1024 у
    // старой карты 2048px) — (blocksX-1)*S+R1 обязано остаться < 65536
    const S = 5
    const R1 = 1000

    const values = new Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bx = Math.floor(x / block)
        const lx = x % block
        const ly = y % block
        const intra = lx === 1 || ly === 1 ? R1 : 0
        values[y * width + x] = bx * S + intra
      }
    }
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    // p99(1×1) той же формулой, что и в реализации: по-блочные min/max → размах → p99
    const blockMin = new Array<number>(blocksX * blocksY).fill(65535)
    const blockMax = new Array<number>(blocksX * blocksY).fill(0)
    for (let y = 0; y < height; y++) {
      const by = Math.floor(y / block)
      for (let x = 0; x < width; x++) {
        const bx = Math.floor(x / block)
        const b = by * blocksX + bx
        const raw = values[y * width + x]
        if (raw < blockMin[b]) blockMin[b] = raw
        if (raw > blockMax[b]) blockMax[b] = raw
      }
    }
    const ranges1x1 = blockMin.map((lo, i) => blockMax[i] - lo)
    const sorted = [...ranges1x1].sort((a, b) => a - b)
    const p99_1x1 = sorted[Math.floor(0.99 * (sorted.length - 1))]

    expect(p99_1x1).toBe(R1) // сконструировано так, что размах любого блока = R1
    expect(field.geometricErrorMeters(2)).toBeCloseTo(p99_1x1, 6)
    // p99(2×2) = S+R1 строго больше p99(1×1) — не тот же режим, что у ℓ2
    expect(field.geometricErrorMeters(1)).toBeGreaterThan(field.geometricErrorMeters(2))

    // монотонность по всем уровням на карте, где фолбэк не участвует
    let prev = Infinity
    for (let level = 1; level <= 6; level++) {
      const e = field.geometricErrorMeters(level)
      expect(e).toBeGreaterThan(0)
      expect(e).toBeLessThanOrEqual(prev)
      prev = e
    }
  })
})
