import { describe, expect, it } from 'vitest'
import { BufferAttribute, SphereGeometry, Vector2, Vector3 } from 'three'
import {
  CLEARANCE_GRID_BASE_SEGMENTS,
  CLEARANCE_MARGIN_METERS,
  TerrainHeightField,
  terrainHeightFieldFor
} from '@/core/terrain/TerrainHeightField'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { SpaceScale } from '@/core/constants'
import { TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'
import { TERRAIN_QUADTREE_MAX_LEVEL } from '@/core/terrain/terrainQuadtreeSelect'
import { buildPatchIndex, buildTerrainPatchGeometry } from '@/core/terrain/terrainPatchGeometry'
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

  it('одиночная яма поднимает клиренс на вторых разностях вокруг себя, дальние не трогает', () => {
    // 64×32, min 0 max 65535 (метры = raw): яма глубиной D=10000 в одном
    // текселе (col8, row16). block=1 (64 < CLEARANCE_GRID_BASE_SEGMENTS),
    // ячейка = тексель. Поточечная модель (вторые разности): у самой ямы
    // sag=D (½·|Δ²|=½·2D), у соседей col7/col9 — D/2 (½·|Δ²|=½·D). Дилатация
    // 3×3 растягивает МАКСИМУМ окна на соседей: col9 (сосед ямы) наследует
    // sag ямы (D) через дилатацию, col10 — только sag col9 (D/2), col11 —
    // уже вне дилатационной досягаемости (только базовый запас).
    const values = new Array(64 * 32).fill(20000)
    values[16 * 64 + 8] = 10000 // строка 16, столбец 8, D=10000
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    // направление в яму: столбец 8 → u = 8.5/64, строка 16 → v = 16.5/32
    expect(field.clearanceMeters(uvToDir(8.5 / 64, 16.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // столбец 9 — сосед ямы, дилатация подтягивает полный sag ямы (D)
    expect(field.clearanceMeters(uvToDir(9.5 / 64, 16.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // столбец 10 — дилатация видит только sag столбца 9 (D/2)
    expect(field.clearanceMeters(uvToDir(10.5 / 64, 16.5 / 32))).toBeCloseTo(5000 + CLEARANCE_MARGIN_METERS, 3)
    // столбец 11 — вне досягаемости, только базовый запас
    expect(field.clearanceMeters(uvToDir(11.5 / 64, 16.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
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

  it('крупная карта (block > 1): поточечная модель находит одиночную яму внутри блока', () => {
    // width = 2×CLEARANCE_GRID_BASE_SEGMENTS → block=round(2)=2 — ячейка сетки
    // провиса вдвое шире текселя. Поточечная модель (вторые разности)
    // считается ПО ТЕКСЕЛЯМ независимо от block — блок здесь влияет только на
    // то, в какую ячейку сворачивается MAX; крупная ячейка не размазывает
    // яму на весь блок (в отличие от бывшей range-агрегации по блокам,
    // чинившейся сужением окна в прошлом раунде) — единственный поднятый
    // тексель просто max-пулится в СВОЮ ячейку, дальние ячейки не задеты.
    const width = CLEARANCE_GRID_BASE_SEGMENTS * 2
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

  it('яма у шва долготы (столбец 0) поднимает клиренс по обе стороны шва', () => {
    // 64×32, block=1: яма в столбце 0 — вторые разности заворачивают долготу
    // (xLo/xHi по модулю width), симметрично «одиночной яме» из теста выше,
    // только зеркально через шов: столбец 63 (сосед ямы через шов) получает
    // дилатацией полный sag ямы (D=10000), столбец 62 — только sag столбца
    // 63 (D/2), столбец 1 (сосед с другой стороны) — тоже полный sag ямы.
    const values = new Array(64 * 32).fill(20000)
    values[16 * 64 + 0] = 10000 // строка 16, столбец 0 — у самого шва
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    // сама яма
    expect(field.clearanceMeters(uvToDir(0.5 / 64, 16.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // столбец 63 — сосед ямы через шов, дилатация подтягивает полный sag ямы
    expect(field.clearanceMeters(uvToDir(63.5 / 64, 16.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // столбец 62 — дилатация видит только sag столбца 63 (D/2)
    expect(field.clearanceMeters(uvToDir(62.5 / 64, 16.5 / 32))).toBeCloseTo(5000 + CLEARANCE_MARGIN_METERS, 3)
    // столбец 61 — вне досягаемости, только базовый запас
    expect(field.clearanceMeters(uvToDir(61.5 / 64, 16.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
    // столбец 1 — сосед ямы с другой стороны, тоже полный sag
    expect(field.clearanceMeters(uvToDir(1.5 / 64, 16.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // середина карты — вне окрестности шва и ямы
    expect(field.clearanceMeters(uvToDir(32.5 / 64, 16.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
  })

  it('полярная яма (строка 0) считается без падения и не течёт на другой полюс', () => {
    // 64×32, block=1: яма в строке 0 (у полюса) — широта должна клемпиться
    // (yLo=0=y при y=0 в вычислении второй разности по широте), а не
    // заворачиваться на противоположный полюс. Строка 0 здесь НЕ высокоширотная
    // по порогу span (карта 64 текселя, ratio до 1.5 не дотягивает — см.
    // отдельный полярный тест ниже с картой лунного масштаба) — работает
    // обычная поточечная модель, тот же паттерн «сосед — полный sag, через
    // один — половина, дальше — только запас», что и у экваториальной ямы.
    const values = new Array(64 * 32).fill(20000)
    values[0 * 64 + 32] = 10000 // строка 0, столбец 32
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    expect(field.clearanceMeters(uvToDir(32.5 / 64, 0.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // строка 1 — сосед ямы, дилатация подтягивает полный sag ямы
    expect(field.clearanceMeters(uvToDir(32.5 / 64, 1.5 / 32))).toBeCloseTo(10000 + CLEARANCE_MARGIN_METERS, 3)
    // строка 2 — дилатация видит только sag строки 1
    expect(field.clearanceMeters(uvToDir(32.5 / 64, 2.5 / 32))).toBeCloseTo(5000 + CLEARANCE_MARGIN_METERS, 3)
    // строка 3 — вне досягаемости, только базовый запас
    expect(field.clearanceMeters(uvToDir(32.5 / 64, 3.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
    // противоположный полюс — только базовый запас, клампа не должно перетекать
    expect(field.clearanceMeters(uvToDir(32.5 / 64, 31.5 / 32))).toBeCloseTo(CLEARANCE_MARGIN_METERS, 3)
  })
})

describe('TerrainHeightField: восток-запад окно расширяется к полюсу, когда вторая разность соседних текселей перестаёт ограничивать хорду', () => {
  const uvToDir = (u: number, v: number): Vector3 => {
    const theta = v * Math.PI
    const phi = u * 2 * Math.PI
    return new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
  }

  // width = CLEARANCE_GRID_BASE_SEGMENTS, block=1 (ячейка = тексель —
  // изолирует эффект от дилатации по крупным ячейкам). equatorStepTexels =
  // 1024/TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS(16384) = 0.0625. Строка 0: theta =
  // π·0.5/64 ≈ 1.406°, cosLat = sin(theta) ≈ 0.02454, span = round(0.0625 /
  // cosLat) ≈ round(2.55) = 3 ≥ 2 — высокоширотная, восток-запад переходит на
  // размах по скользящему окну ±3 текселя (`slidingRangeWrap`), а не вторую
  // разность соседних текселей.
  const width = CLEARANCE_GRID_BASE_SEGMENTS
  const height = 64
  const pitCol = 200

  it('на высокоширотной строке (row 0) клиренс дотягивается на несколько текселей дальше экватора', () => {
    const values = new Array(width * height).fill(20000)
    values[0 * width + pitCol] = 10000
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    // офсет 4: вне досягаемости обычной (не полярной) поточечной модели —
    // ловится только скользящим окном ±3 (плюс 1 ячейка дилатации)
    expect(field.clearanceMeters(uvToDir((pitCol - 4 + 0.5) / width, 0.5 / height))).toBeCloseTo(
      10000 + CLEARANCE_MARGIN_METERS,
      3
    )
    // офсет 8: уже вне скользящего окна — только базовый запас
    expect(field.clearanceMeters(uvToDir((pitCol - 8 + 0.5) / width, 0.5 / height))).toBeCloseTo(
      CLEARANCE_MARGIN_METERS,
      3
    )

    // sagMeters (раунд 3, тот же гибрид, БЕЗ дилатации и без margin — честная
    // поточечная граница окна ±3, а не размазанная ещё на ±1 ячейку дилатацией):
    // офсет 3 (внутри окна) — полный провис ямы, офсет 4 (сразу за окном) — 0
    expect(field.sagMeters(uvToDir((pitCol - 3 + 0.5) / width, 0.5 / height))).toBeCloseTo(10000, 3)
    expect(field.sagMeters(uvToDir((pitCol - 4 + 0.5) / width, 0.5 / height))).toBeCloseTo(0, 3)
  })

  it('регрессия: на экваторе (row 32) та же яма даёт узкую (не полярную) досягаемость', () => {
    const values = new Array(width * height).fill(20000)
    values[32 * width + pitCol] = 10000
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    // офсет 4 на экваторе вне досягаемости обычной поточечной модели (не
    // высокоширотная строка — офсет 4 уже накрыт только у полюса, см. тест выше)
    expect(field.clearanceMeters(uvToDir((pitCol - 4 + 0.5) / width, 32.5 / height))).toBeCloseTo(
      CLEARANCE_MARGIN_METERS,
      3
    )
  })
})

describe('TerrainHeightField: sagMeters ≥ фактический провис хорды максимального уровня (property-тест)', () => {
  it('на нетривиальном рельефе (двумерная синусоида, кинки на каждом текселе) sagMeters(dir̂)+margin не меньше провиса мешерной хорды по плотной выборке точек патча', () => {
    // 8192×2048: непрерывная, но некусочно-линейная высота — дискретизация в
    // текселях даёт реальный излом (вторую разность ≠ 0) почти в каждом
    // текселе, ФАКТИЧЕСКИЙ рельеф, не единичная яма. Строится РЕАЛЬНЫЙ патч
    // максимального уровня (buildTerrainPatchGeometry, TERRAIN_QUADTREE_MAX_LEVEL,
    // TERRAIN_PATCH_SEGMENTS — продакшн-параметры, не урезанные для теста) —
    // это и есть та сетка, под которую должен быть посчитан клиренс.
    const width = 8192
    const height = 2048
    const minMeters = -2000
    const maxMeters = 2000
    const values = new Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const hMeters = 900 * Math.sin((2 * Math.PI * x) / 7) + 900 * Math.sin((2 * Math.PI * y) / 5)
        const raw = Math.round(((hMeters - minMeters) / (maxMeters - minMeters)) * 65535)
        values[y * width + x] = Math.min(65535, Math.max(0, raw))
      }
    }
    const field = new TerrainHeightField(makeMap(width, height, values, minMeters, maxMeters), R_KM)

    const face = 0
    const level = TERRAIN_QUADTREE_MAX_LEVEL
    const i = 32
    const j = 32
    const segments = TERRAIN_PATCH_SEGMENTS
    const index = buildPatchIndex(segments)
    const { geometry, center } = buildTerrainPatchGeometry(field, face, i, j, level, segments, index, 0)
    const positions = geometry.getAttribute('position') as BufferAttribute

    const gridVertex = (a: number, b: number): Vector3 => {
      const k = b * (segments + 1) + a
      return new Vector3(positions.getX(k) + center.x, positions.getY(k) + center.y, positions.getZ(k) + center.z)
    }

    // диагональный сплит квада — тот же, что в buildPatchIndex: v00-v10-v11 / v00-v11-v01
    const chordPoint = (v00: Vector3, v10: Vector3, v01: Vector3, v11: Vector3, fa: number, fb: number): Vector3 => {
      const point = new Vector3()
      if (fb <= fa) {
        return point.addScaledVector(v00, 1 - fa).addScaledVector(v10, fa - fb).addScaledVector(v11, fb)
      }
      return point.addScaledVector(v00, 1 - fb).addScaledVector(v11, fa).addScaledVector(v01, fb - fa)
    }

    const SAMPLES_PER_CELL = 2
    let checked = 0
    let maxProvisMeters = -Infinity

    for (let b = 0; b < segments; b++) {
      for (let a = 0; a < segments; a++) {
        const v00 = gridVertex(a, b)
        const v10 = gridVertex(a + 1, b)
        const v01 = gridVertex(a, b + 1)
        const v11 = gridVertex(a + 1, b + 1)

        for (let sy = 0; sy <= SAMPLES_PER_CELL; sy++) {
          for (let sx = 0; sx <= SAMPLES_PER_CELL; sx++) {
            const point = chordPoint(v00, v10, v01, v11, sx / SAMPLES_PER_CELL, sy / SAMPLES_PER_CELL)

            const meshRadiusUnits = point.length()
            const dir = point.clone().normalize()
            const meshHeightMeters = (meshRadiusUnits / SpaceScale - field.radiusKm) * 1000
            const trueHeightMeters = field.heightMeters(dir)
            const provisMeters = meshHeightMeters - trueHeightMeters // >0: хорда бугрит НАД честной поверхностью

            // sagMeters — поточечный, без запаса; margin — та же подушка, что и
            // в продакшн-потребителе (CameraCollision.pointwiseFloorRadiusUnits),
            // страхует билинейный бленд sagMeters между текселями (см. докблок)
            expect(field.sagMeters(dir) + CLEARANCE_MARGIN_METERS).toBeGreaterThanOrEqual(provisMeters - 1e-6)

            if (provisMeters > maxProvisMeters) maxProvisMeters = provisMeters
            checked++
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(30000)
    // фикстура нетривиальна: реальный бугор хорды над поверхностью есть (не
    // вырожденный тест на плоском рельефе)
    expect(maxProvisMeters).toBeGreaterThan(0.01)
  })
})

describe('TerrainHeightField: билинейная выборка клиренса', () => {
  const uvToDir = (u: number, v: number): Vector3 => {
    const theta = v * Math.PI
    const phi = u * 2 * Math.PI
    return new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
  }

  it('на центре ячейки — точное значение, между центрами — монотонная интерполяция', () => {
    // 16×2 (обе строки одинаковы — north-south и перекрёстный член
    // тождественно 0, чистая проверка east-west и билинейки сетки провиса).
    // Изолированная яма глубиной D=8000 на индексе 8, фон 20000. Поточечно:
    // idx7=D/2=4000, idx8=D=8000, idx9=D/2=4000, остальные 0. Дилатация 3×3
    // (MAX по соседям): idx6=4000, idx7=8000, idx8=8000, idx9=8000, idx10=4000,
    // idx11=0 — по обе стороны от пика два РАЗНЫХ соседних значения (8000 и
    // 4000), удобная пара для проверки билинейной интерполяции между ячейками.
    const width = 16
    const D = 8000
    const row = new Array(width).fill(20000)
    row[8] = 20000 - D
    const values = [...row, ...row]
    const field = new TerrainHeightField(makeMap(width, 2, values, 0, 65535), R_KM)

    const gridAt = (cx: number): number => field.clearanceMeters(uvToDir((cx + 0.5) / width, 0.5))

    const c9 = gridAt(9) // дилатация: max(idx8=8000, idx9=4000, idx10=0) = 8000 (+margin)
    const c10 = gridAt(10) // дилатация: max(idx9=4000, idx10=0, idx11=0) = 4000 (+margin)
    expect(c9).toBeCloseTo(D + CLEARANCE_MARGIN_METERS, 6)
    expect(c10).toBeCloseTo(D / 2 + CLEARANCE_MARGIN_METERS, 6)

    // ровно между центрами ячеек 9 и 10 — точное среднее (fx=0.5)
    const mid = field.clearanceMeters(uvToDir((9.5 + 10.5) / 2 / width, 0.5))
    expect(mid).toBeCloseTo((c9 + c10) / 2, 6)

    // монотонность: четверть пути от c9 к c10 лежит строго между ними
    const quarter = field.clearanceMeters(uvToDir((9.5 + (10.5 - 9.5) * 0.25) / width, 0.5))
    expect(quarter).toBeLessThan(c9)
    expect(quarter).toBeGreaterThan(mid)
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
    // width = 2×CLEARANCE_GRID_BASE_SEGMENTS → block=round(2)=2, blocksX=1024,
    // blocksY=512 (как в clearance-тесте «крупная карта»). ε-пирамида не
    // тронута этим раундом — блочный базис (block) снова тот же самый по
    // формуле/числу, что был исторически до этапа квадродерева. Внутриблочный
    // размах = R1 у КАЖДОГО блока (не зависит от bx/by) — p99(1×1)=R1 точно.
    // Базовая высота блока растёт с bx на шаг S — окно 2×2 захватывает
    // соседний блок выше на S, p99(2×2)=S+R1 строго больше p99(1×1): различие
    // само по себе доказывает, что ℓ2 не подменился фолбэком на p99(2×2).
    const width = CLEARANCE_GRID_BASE_SEGMENTS * 2
    const height = 1024
    const block = 2
    const blocksX = width / block
    const blocksY = height / block
    const S = 50
    const R1 = 200

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
