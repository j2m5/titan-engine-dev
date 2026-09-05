import { describe, expect, it, vi } from 'vitest'
import { BufferAttribute, SphereGeometry, Vector2, Vector3 } from 'three'
import {
  CLEARANCE_GRID_BASE_SEGMENTS,
  CLEARANCE_MARGIN_METERS,
  TerrainHeightField,
  terrainHeightFieldFor
} from '@/core/terrain/TerrainHeightField'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { SpaceScale } from '@/core/constants'
import { TERRAIN_PATCH_SEGMENTS, cubeFaceDirection } from '@/core/terrain/cubeSphere'
import { TERRAIN_QUADTREE_MAX_LEVEL, TERRAIN_QUADTREE_MIN_LEVEL } from '@/core/terrain/terrainQuadtreeSelect'
import { buildPatchIndex, buildTerrainPatchGeometry } from '@/core/terrain/terrainPatchGeometry'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import { constantHeightField } from '@/core/terrain/constantHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

// Полоса (Task 4) включена по умолчанию — этот файл проверяет ПОЛЕ КАРТЫ
// (билинейка, провис, ε, пирамиды, кэш), поэтому там, где тест пинит точную
// высоту/радиус/кэш-идентичность по значениям карты, полоса явно выключается.
const MIDBAND_OFF = { ...MIDBAND_DEFAULTS, midbandStrength: 0 }

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
    const field = new TerrainHeightField(makeMap(4, 2, new Array(8).fill(65535), 0, 1000), R_KM, MIDBAND_OFF)

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

// Финальное ревью water-foundation, находка №3, фикс-раунд 2 (рулинг
// владельца): фикс-раунд 1 (ленивая постройка пирамиды) закешировал не ту
// структуру — снимок blockMax/blocksX/blocksY на входе билдера пережил бы
// конструктор НАВСЕГДА (поле кешируется в terrainHeightFieldFor на весь
// сеанс), ~1 МиБ на тело против 128 КиБ готовой пирамиды. Откачено: пирамида
// снова строится безусловно и синхронно в конструкторе для обычных полей
// (рост времени старта принят рулингом владельца — критерий здесь память, не
// время загрузки); единственный оставшийся спецслучай — КОНСТАНТНОЕ поле
// (`constantHeightField`, вода): максимум узла тождественно уровню, пирамида
// ему не нужна вовсе. Билдер приватный — спай идёт через прототип с
// приведением к `any`, единственный способ достучаться до приватного метода
// класса извне теста.
describe('TerrainHeightField: пирамида nodeMaxHeightMeters (Task 5, финальное ревью, находка №3, фикс-раунд 2)', () => {
  it('обычное поле: пирамида строится безусловно и синхронно в конструкторе, до первого nodeMaxHeightMeters', () => {
    const spy = vi.spyOn(TerrainHeightField.prototype as unknown as { buildNodeMaxHeightPyramid: () => Float32Array }, 'buildNodeMaxHeightPyramid')

    const field = new TerrainHeightField(makeMap(4, 2, [0, 65535, 0, 0, 0, 0, 0, 0]), R_KM)
    expect(spy).toHaveBeenCalledTimes(1) // конструктор уже построил её, не первый запрос

    const first = field.nodeMaxHeightMeters(0, TERRAIN_QUADTREE_MAX_LEVEL, 0, 0)
    expect(Number.isFinite(first)).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1) // запрос не перестраивает — билдер зовётся ровно один раз, конструктором

    spy.mockRestore()
  })

  it('константное поле (min === max): конструктор пирамиду НЕ строит вовсе — ни один вызов буилдера', () => {
    const spy = vi.spyOn(TerrainHeightField.prototype as unknown as { buildNodeMaxHeightPyramid: () => Float32Array }, 'buildNodeMaxHeightPyramid')

    const field = constantHeightField(R_KM, -667.2) // Явин IV, уровень воды в data

    field.nodeMaxHeightMeters(0, TERRAIN_QUADTREE_MIN_LEVEL, 0, 0)
    field.nodeMaxHeightMeters(3, TERRAIN_QUADTREE_MAX_LEVEL, 5, 7)

    expect(spy).not.toHaveBeenCalled()

    spy.mockRestore()
  })

  it('константное поле: nodeMaxHeightMeters == levelMeters на любых валидных (face, level, i, j) — углы, оба конца диапазона уровней, все грани', () => {
    const LEVEL_METERS = 1234.5
    const field = constantHeightField(R_KM, LEVEL_METERS)

    for (let face = 0; face < 6; face++) {
      for (const level of [TERRAIN_QUADTREE_MIN_LEVEL, TERRAIN_QUADTREE_MAX_LEVEL]) {
        const patches = 2 ** level
        for (const i of [0, patches - 1]) {
          for (const j of [0, patches - 1]) {
            expect(field.nodeMaxHeightMeters(face, level, i, j)).toBeCloseTo(LEVEL_METERS, 6)
          }
        }
      }
    }
  })
})

describe('terrainHeightFieldFor: кэш', () => {
  it('одна карта — один экземпляр', () => {
    const map = makeMap(2, 2, [0, 0, 0, 0])

    expect(terrainHeightFieldFor(map, R_KM)).toBe(terrainHeightFieldFor(map, R_KM))
  })

  it('одна карта, разные радиусы (шаренная карта вымышленных лун) → разные экземпляры со своим surfaceRadiusUnits; тот же радиус повторно — тот же экземпляр', () => {
    const map = makeMap(2, 2, [0, 0, 0, 0])
    const dir = new Vector3(1, 0, 0)

    const fieldBig = terrainHeightFieldFor(map, 1740, MIDBAND_OFF)
    const fieldSmall = terrainHeightFieldFor(map, 175, MIDBAND_OFF)

    expect(fieldBig).not.toBe(fieldSmall)
    expect(fieldBig.surfaceRadiusUnits(dir)).toBeCloseTo(toThreeJSUnits(1740), 6)
    expect(fieldSmall.surfaceRadiusUnits(dir)).toBeCloseTo(toThreeJSUnits(175), 6)

    expect(terrainHeightFieldFor(map, 1740, MIDBAND_OFF)).toBe(fieldBig)
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
  // π·0.5/64 ≈ 1.406°, cosLat = sin(theta) ≈ 0.02454, вершинный пролёт
  // 0.0625/cosLat ≈ 2.55 текселя — окно кривизнной суммы раскрыто на ±1
  // тексель целиком плюс дробный вес 0.55 на паре ±2 (sagWindow), тогда как
  // на экваторе оно сжато в один тексель.
  const width = CLEARANCE_GRID_BASE_SEGMENTS
  const height = 64
  const pitCol = 200

  it('на высокоширотной строке (row 0) клиренс дотягивается на несколько текселей дальше экватора и УБЫВАЕТ с расстоянием', () => {
    const values = new Array(width * height).fill(20000)
    values[0 * width + pitCol] = 10000
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    const sagAt = (offset: number): number =>
      field.sagMeters(uvToDir((pitCol + offset + 0.5) / width, 0.5 / height))

    // Досягаемость: офсет −3 внутри окна (дробный край до ±2 плюс вторая
    // разность, которую яма наводит на своих соседях), офсет −4 — уже за ним.
    // На экваторе (тест ниже) ненулевым остаётся только сам тексель ямы.
    expect(sagAt(-3)).toBeGreaterThan(1000)
    expect(sagAt(-4)).toBeCloseTo(0, 3)

    // Убывание — то, чего у прежней размаховой оценки НЕ БЫЛО: размах по окну
    // давал одинаковый полный провис ямы на всех офсетах до края окна, будто
    // хорда в трёх текселях от ямы проседает так же, как над ней самой.
    // Кривизнная мажоранта считает вклад излома с весом его удалённости.
    // Вплотную к яме (офсеты 0..−2) видно не убывание, а потолок-размах: там
    // кривизнная сумма выше глубины ямы, и её срезает до 10000 ровно.
    expect(sagAt(-2)).toBeGreaterThan(sagAt(-3))
    expect(sagAt(-3)).toBeGreaterThan(sagAt(-4))

    // Клиренс — тот же провис плюс ячейка дилатации и базовый запас
    expect(field.clearanceMeters(uvToDir((pitCol - 4 + 0.5) / width, 0.5 / height))).toBeGreaterThan(1000)
    // офсет 8: далеко за окном — только базовый запас
    expect(field.clearanceMeters(uvToDir((pitCol - 8 + 0.5) / width, 0.5 / height))).toBeCloseTo(
      CLEARANCE_MARGIN_METERS,
      3
    )
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

describe('TerrainHeightField: полоса вершинного пролёта (1, 1.5] текселя — окно раскрывается дробно, а не по порогу округления', () => {
  const uvToDir = (u: number, v: number): Vector3 => {
    const theta = v * Math.PI
    const phi = u * 2 * Math.PI
    return new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
  }

  // width = CLEARANCE_GRID_BASE_SEGMENTS, block=1 (та же изоляция от
  // дилатации, что и в тесте выше). equatorStepTexels = 1024/16384 = 0.0625.
  // Строка 8: theta = π·8.5/512 ≈ 2.988°, cosLat ≈ 0.05213, пролёт вершины
  // 0.0625/0.05213 ≈ 1.199 — строго в полосе (1, 1.5]: шире текселя, но
  // ненамного. Окно кривизнной суммы здесь раскрыто ТОЛЬКО дробным весом
  // 0.199 на паре соседей — на этой строке и проверяется, что раскрытие
  // идёт непрерывно по пролёту, а не скачком по порогу округления (прежняя
  // модель округляла пролёт до целого окна: round(1.199)=1 не видел ничего
  // за соседним текселем, ceil(1.199)=2 сразу видел два — оба ответа
  // ступенчаты по широте, что и было находкой ревью №2).
  const width = CLEARANCE_GRID_BASE_SEGMENTS
  const height = 512
  const row = 8
  const pitCol = 200

  it('яма в 2 текселях от точки запроса видна, но вкладом по своей удалённости, а не целиком', () => {
    const values = new Array(width * height).fill(20000)
    const D = 10000
    values[row * width + pitCol] = 20000 - D
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    const sagAt = (offset: number): number =>
      field.sagMeters(uvToDir((pitCol + offset + 0.5) / width, (row + 0.5) / height))

    // офсет 0 — прямое попадание в яму: кривизнная мажоранта здесь выше
    // размаха, и её срезает потолок ровно до глубины ямы
    expect(sagAt(0)).toBeCloseTo(D, 3)

    // офсет 2 — досягаемость шире одного текселя: пролёт вершины ~1.2 текселя,
    // хорда может опираться на тексель в двух позициях от запроса. Прежняя
    // модель отдавала здесь ПОЛНУЮ глубину ямы (размах по окну), новая —
    // вклад излома с весом его удалённости, то есть заметно меньше
    expect(sagAt(2)).toBeGreaterThan(0)
    expect(sagAt(2)).toBeLessThan(D / 2)

    // убывание с удалением — то, чего у размаховой оценки не было
    expect(sagAt(1)).toBeGreaterThan(sagAt(2))

    // офсет 3 — контроль: рост окна не безграничен
    expect(sagAt(3)).toBeCloseTo(0, 3)
  })
})

/**
 * Общая проверка property-теста «sagMeters ≥ фактический провис хорды» для
 * одного адреса патча максимального уровня квадродерева (buildTerrainPatchGeometry,
 * TERRAIN_QUADTREE_MAX_LEVEL, TERRAIN_PATCH_SEGMENTS — продакшн-параметры, не
 * урезанные для теста) — это и есть та сетка, под которую должен быть
 * посчитан клиренс. Возвращает сводку (checked/maxProvisMeters) для проверки
 * нетривиальности фикстуры вызывающим.
 */
function assertSagCoversPatchChord(
  field: TerrainHeightField,
  face: number,
  i: number,
  j: number
): { checked: number; maxProvisMeters: number } {
  const level = TERRAIN_QUADTREE_MAX_LEVEL
  const segments = TERRAIN_PATCH_SEGMENTS
  const index = buildPatchIndex(segments)
  const { geometry, center } = buildTerrainPatchGeometry(field, face, i, j, level, segments, index, 0, detailWrapFor(undefined))
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

  return { checked, maxProvisMeters }
}

describe('TerrainHeightField: sagMeters ≥ фактический провис хорды максимального уровня (property-тест)', () => {
  // 8192×2048: непрерывная, но некусочно-линейная высота — дискретизация в
  // текселях даёт реальный излом (вторую разность ≠ 0) почти в каждом
  // текселе, ФАКТИЧЕСКИЙ рельеф, не единичная яма. Общая фикстура для обеих
  // проверок ниже (экватор и средние широты).
  const buildSyntheticField = (): TerrainHeightField => {
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
    // полоса выключена: тест сравнивает мешерную хорду (строится по
    // sampleMeters, без полосы) с field.heightMeters — с полосой по
    // умолчанию они честно разошлись бы на вклад полосы
    return new TerrainHeightField(makeMap(width, height, values, minMeters, maxMeters), R_KM, MIDBAND_OFF)
  }

  it('на нетривиальном рельефе (двумерная синусоида, кинки на каждом текселе), патч в центре грани (экватор): sagMeters(dir̂)+margin не меньше провиса мешерной хорды по плотной выборке точек патча', () => {
    const field = buildSyntheticField()

    const { checked, maxProvisMeters } = assertSagCoversPatchChord(field, 0, 32, 32)

    expect(checked).toBeGreaterThan(30000)
    // фикстура нетривиальна: реальный бугор хорды над поверхностью есть (не
    // вырожденный тест на плоском рельефе)
    expect(maxProvisMeters).toBeGreaterThan(0.01)
    // 36k+ точек плотной выборки: под параллельной нагрузкой полного прогона
    // дефолтных 5 с не хватает — таймаут явный, тест честно тяжёлый
  }, 20_000)

  // Дополняет проверку выше на реальном патче средних широт (~60–70°, где
  // вершинный пролёт максимального уровня ~1.2 экваториального текселя —
  // ceil-порог из Fix 1 актуален для строк этой карты). Сам по себе провал
  // ceil→round здесь НЕ ловит: маржи сетки/margin и max(ew,ns,cross) на этой
  // синтетике перекрывают узкую (round) модель с запасом даже без широкого
  // окна — точечное занижение из Fix 1 закрыто прицельным тестом досягаемости
  // выше («полоса вершинного пролёта (1, 1.5] текселя»), который сравнивает round
  // и ceil впритык на изолированной яме. Здесь регрессия иного класса: что
  // sag вообще не занижен НИЖЕ фактического провиса реального квадродерева
  // на этой широте (общая защита, не специфичная для одного порога).
  it('та же проверка на средних широтах ~60–70° (face 2, i=32 j=49): реальный патч максимального уровня квадродерева, не единичная яма', () => {
    const field = buildSyntheticField()
    const face = 2
    const i = 32
    const j = 49

    // адрес патча действительно лежит в заявленной полосе широт — не завязано
    // на удачу, а посчитано той же равноугольной проекцией, что и билдер патча
    const level = TERRAIN_QUADTREE_MAX_LEVEL
    const patches = 1 << level
    const span = 2 / patches
    const s0 = -1 + i * span
    const t0 = -1 + j * span
    const centerDir = cubeFaceDirection(face, s0 + span / 2, t0 + span / 2, new Vector3())
    const latitudeDeg = (Math.asin(centerDir.y) * 180) / Math.PI
    expect(latitudeDeg).toBeGreaterThan(60)
    expect(latitudeDeg).toBeLessThan(70)

    const { checked, maxProvisMeters } = assertSagCoversPatchChord(field, face, i, j)

    expect(checked).toBeGreaterThan(30000)
    expect(maxProvisMeters).toBeGreaterThan(0.01)
    // см. таймаут теста выше — та же плотная выборка
  }, 20_000)

  it('та же проверка у полюса (face 2, i=32 j=36, ~84°): вершинный пролёт вчетверо шире текселя, EW-модель работает широким окном', () => {
    const field = buildSyntheticField()
    const face = 2
    const i = 32
    const j = 36

    const level = TERRAIN_QUADTREE_MAX_LEVEL
    const patches = 1 << level
    const span = 2 / patches
    const centerDir = cubeFaceDirection(face, -1 + i * span + span / 2, -1 + j * span + span / 2, new Vector3())
    const latitudeDeg = (Math.asin(centerDir.y) * 180) / Math.PI
    expect(latitudeDeg).toBeGreaterThan(80)

    const { checked, maxProvisMeters } = assertSagCoversPatchChord(field, face, i, j)

    expect(checked).toBeGreaterThan(30000)
    expect(maxProvisMeters).toBeGreaterThan(0.01)
  }, 20_000)
})

describe('TerrainHeightField: EW-модель провиса непрерывна на границе расширения окна', () => {
  /**
   * Граница — там, где вершинный пролёт максимального уровня равен текселю:
   * `equatorStepTexels / cos(широты) = 1`. Ниже неё провис хорды ограничивает
   * вторая разность соседних текселей, выше окно обязано расширяться. Прежняя
   * модель меняла на этой широте не окно, а САМУ величину — с половины второй
   * разности на полный размах по окну, то есть с кривизны на наклон: оценка
   * подскакивала в разы, и пол камеры (`pointwiseFloorRadiusUnits`) вместе с
   * ней — толчок вверх на ровном месте при перелёте через параллель.
   *
   * Карта 2048×1024: equatorStepTexels = 2048/16384 = 0.125, граница на
   * широте acos(0.125) ≈ 82.8°.
   */
  const width = 2048
  const height = 1024
  const minMeters = -2000
  const maxMeters = 2000

  const buildField = (): TerrainHeightField => {
    const values = new Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // многооктавный рельеф: излом в каждом текселе, но и выраженный наклон —
        // именно на нём прежняя размаховая оценка и расходилась с кривизнной
        let h = 0
        let amplitude = 900
        let fx = 0.05
        let fy = 0.09
        for (let octave = 0; octave < 5; octave++) {
          h += amplitude * Math.sin(x * fx + octave * 1.7) * Math.cos(y * fy + octave * 2.3)
          amplitude *= 0.55
          fx *= 2.1
          fy *= 2.1
        }
        const raw = Math.round(((h - minMeters) / (maxMeters - minMeters)) * 65535)
        values[y * width + x] = Math.min(65535, Math.max(0, raw))
      }
    }

    return new TerrainHeightField(makeMap(width, height, values, minMeters, maxMeters), R_KM)
  }

  /** Средний sag по кольцу долгот — усреднение гасит рельеф и оставляет саму модель. */
  const meanSagAtLatitude = (field: TerrainHeightField, latitudeDeg: number): number => {
    const latitude = (latitudeDeg * Math.PI) / 180
    const dir = new Vector3()
    let sum = 0
    const samples = 128

    for (let k = 0; k < samples; k++) {
      const longitude = (k / samples) * 2 * Math.PI
      dir
        .set(-Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude))
        .normalize()
      sum += field.sagMeters(dir)
    }

    return sum / samples
  }

  it('средний sag по обе стороны границы не расходится в разы — модель сшита, а не переключена', () => {
    const field = buildField()
    const switchLatitudeDeg = (Math.acos(width / (4 * 2 ** TERRAIN_QUADTREE_MAX_LEVEL * TERRAIN_PATCH_SEGMENTS)) * 180) / Math.PI

    const below = meanSagAtLatitude(field, switchLatitudeDeg - 0.4)
    const above = meanSagAtLatitude(field, switchLatitudeDeg + 0.4)

    expect(below).toBeGreaterThan(0) // фикстура нетривиальна: провис вообще есть
    expect(above / below).toBeLessThan(1.5)
  })

  it('ниже границы (вершинный пролёт ≤ текселя) оценка — ровно половина второй разности, как и была', () => {
    // Плоская карта с одиночной ямой на экваторе: пролёт 0.125 текселя, окно
    // сжато в один тексель. |d2| в самой яме = 2D, в соседях = D — пин на то,
    // что сшивка широкой ветки не сдвинула узкую ни на единицу младшего разряда.
    const D = 10000
    const values = new Array(width * height).fill(30000)
    values[(height / 2) * width + 100] = 30000 - D
    const field = new TerrainHeightField(makeMap(width, height, values), R_KM)

    const equatorV = (height / 2 + 0.5) / height
    const sagAtColumn = (column: number): number => {
      const theta = equatorV * Math.PI
      const phi = ((column + 0.5) / width) * 2 * Math.PI

      return field.sagMeters(
        new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
      )
    }

    expect(sagAtColumn(100)).toBeCloseTo(D, 3)
    expect(sagAtColumn(99)).toBeCloseTo(D / 2, 3)
    expect(sagAtColumn(101)).toBeCloseTo(D / 2, 3)
    expect(sagAtColumn(102)).toBeCloseTo(0, 3)
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

  it('level клампится в диапазон уровней квадродерева', () => {
    const field = new TerrainHeightField(makeMap(4, 2, new Array(8).fill(0)), R_KM)
    expect(field.geometricErrorMeters(TERRAIN_QUADTREE_MIN_LEVEL - 1)).toBe(
      field.geometricErrorMeters(TERRAIN_QUADTREE_MIN_LEVEL)
    )
    expect(field.geometricErrorMeters(TERRAIN_QUADTREE_MAX_LEVEL + 3)).toBe(
      field.geometricErrorMeters(TERRAIN_QUADTREE_MAX_LEVEL)
    )
  })

  /**
   * Связка ε-пирамиды с глубиной дерева. Потолок массива, верх цикла билдера,
   * клампы и формула вершинного шага были зашиты числами 7/6/4/64 при
   * TERRAIN_QUADTREE_MAX_LEVEL = 6, CUBE_EQUATOR_FACES = 4 и
   * TERRAIN_PATCH_SEGMENTS = 64. Подними глубину дерева — и ε(7) молча
   * вернула бы ε(6) через кламп: SSE на седьмом уровне сравнялась бы с
   * шестым, и дерево уходило бы на уровень глубже везде, где ушло на шестой,
   * вчетверо умножая патчи без единой ошибки в консоли (ревью 2026-08-20,
   * находка №4). Эти два теста и есть отсутствовавший громкий отказ.
   */
  it('ε определена на ВСЕЙ глубине квадродерева и строго убывает к листу', () => {
    const values = Array.from({ length: 64 * 32 }, (_, k) => (k * 4001) % 65535)
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    for (let level = TERRAIN_QUADTREE_MIN_LEVEL; level <= TERRAIN_QUADTREE_MAX_LEVEL; level++) {
      const epsilon = field.geometricErrorMeters(level)

      // undefined из короткого массива дал бы здесь NaN, а не число
      expect(Number.isFinite(epsilon)).toBe(true)
      expect(epsilon).toBeGreaterThan(0)
    }

    // Строгость — от уровня, чей вершинный шаг уже мельче блока (там ε
    // масштабируется шагом). Между ℓ1 и ℓ2 равенство законно: у карты с
    // block = 1 тексель окно 1×1 вырождено и ℓ2 честно падает на p99(2×2).
    for (let level = 2; level < TERRAIN_QUADTREE_MAX_LEVEL; level++) {
      expect(field.geometricErrorMeters(level)).toBeGreaterThan(field.geometricErrorMeters(level + 1))
    }
  })

  it('шаг вершинной сетки половинится на уровень — ε соседних подблочных уровней ровно вдвое', () => {
    // Отношение ровно 2 держит формула шага (CUBE_EQUATOR_FACES · 2^level ·
    // TERRAIN_PATCH_SEGMENTS): ошибись в основании или в множителях — и
    // отношение уедет, даже если пирамида по-прежнему заполнена целиком.
    const values = Array.from({ length: 64 * 32 }, (_, k) => (k * 4001) % 65535)
    const field = new TerrainHeightField(makeMap(64, 32, values), R_KM)

    for (let level = 3; level < TERRAIN_QUADTREE_MAX_LEVEL; level++) {
      expect(field.geometricErrorMeters(level) / field.geometricErrorMeters(level + 1)).toBeCloseTo(2, 9)
    }
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

/**
 * Закон убывания ε по уровням. ε(L) — p99 размаха высот в окне вершинного
 * шага уровня; замеряется он ровно на двух окнах (2×2 блока и 1×1 блок),
 * остальные уровни экстраполируются. Экстраполяция была ЛИНЕЙНОЙ — «шаг вдвое
 * мельче, ε вдвое меньше», — а рельеф самоподобен: размах падает как шаг^H,
 * где H (показатель Хёрста) у планетных DEM 0.6–0.9. Линейная экстраполяция
 * при H<1 занижает, и занижение НАКАПЛИВАЕТСЯ с глубиной: замер на fBm с
 * энергией до Найквиста давал ε/честный 0.89 на L2 и 0.48–0.69 на L6.
 *
 * Следствие занижения — SSE меньше настоящей: дерево делится реже, чем
 * обещает ручка sseSplitPixels, и тем сильнее, чем глубже уровень; юбка
 * (ε(L−2)) короче нужного.
 *
 * Тест меряет не абсолютную точность (у неё своя систематика: окно блока —
 * 8 отсчётов, то есть шаг 7, а не 8), а именно ОДНОРОДНОСТЬ: во сколько раз
 * ε расходится с честным p99 на глубоком уровне против измеренного.
 */
describe('TerrainHeightField: ε убывает по закону самоподобия рельефа, а не линейно', () => {
  const width = 4096
  const height = 2048
  const minMeters = -9000
  const maxMeters = 10000

  /** value-noise fBm: октавы от ячейки 1024 до 1 текселя — рельеф самоподобен вплоть до Найквиста. */
  const buildFractalField = (hurst: number): { field: TerrainHeightField; data: Uint16Array } => {
    const acc = new Float32Array(width * height)
    const hash = (x: number, y: number): number => {
      let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
      h = Math.imul(h ^ (h >>> 13), 1274126177)
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295
    }
    const smooth = (t: number): number => t * t * (3 - 2 * t)

    for (let cell = 1024; cell >= 1; cell >>= 1) {
      const amplitude = Math.pow(cell, hurst)
      for (let y = 0; y < height; y++) {
        const gy = y / cell
        const y0 = Math.floor(gy)
        const fy = smooth(gy - y0)
        const row = y * width
        for (let x = 0; x < width; x++) {
          const gx = x / cell
          const x0 = Math.floor(gx)
          const fx = smooth(gx - x0)
          const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * fx
          const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * fx
          acc[row + x] += amplitude * (top + (bottom - top) * fy)
        }
      }
    }

    let lo = Infinity
    let hi = -Infinity
    for (const value of acc) {
      if (value < lo) lo = value
      if (value > hi) hi = value
    }

    const data = new Uint16Array(width * height)
    for (let i = 0; i < acc.length; i++) data[i] = Math.round(((acc[i] - lo) / (hi - lo)) * 65535)

    return { field: new TerrainHeightField(makeMap(width, height, [...data], minMeters, maxMeters), R_KM), data }
  }

  /** Честный p99 размаха в окне вершинного шага: шагу step отвечает окно из step+1 отсчётов. */
  const honestP99 = (data: Uint16Array, step: number): number => {
    const window = step + 1
    const nx = Math.floor((width - window) / step)
    const ny = Math.floor((height - window) / step)
    const ranges = new Float64Array(nx * ny)

    for (let by = 0; by < ny; by++) {
      for (let bx = 0; bx < nx; bx++) {
        let lo = 65535
        let hi = 0
        for (let y = by * step; y < by * step + window; y++) {
          const row = y * width
          for (let x = bx * step; x < bx * step + window; x++) {
            const value = data[row + x]
            if (value < lo) lo = value
            if (value > hi) hi = value
          }
        }
        ranges[by * nx + bx] = hi - lo
      }
    }

    return (
      Float64Array.from(ranges).sort()[Math.floor(0.99 * (nx * ny - 1))] * ((maxMeters - minMeters) / 65535)
    )
  }

  const stepTexelsAt = (level: number): number => width / (4 * 2 ** level * 64)

  it.each([[0.6], [0.75], [0.9]])(
    'на fBm с показателем %s расхождение ε с честным p99 не растёт от измеренного уровня к глубокому',
    (hurst: number) => {
      const { field, data } = buildFractalField(hurst)

      // L2 — уровень, чей шаг РАВЕН блоку: ε там измерена, а не выведена
      const measuredRatio = field.geometricErrorMeters(2) / honestP99(data, stepTexelsAt(2))
      // L4 — два уровня экстраполяции вглубь, ещё в пределах текселя
      const extrapolatedRatio = field.geometricErrorMeters(4) / honestP99(data, stepTexelsAt(4))

      expect(measuredRatio).toBeGreaterThan(0.5)
      expect(extrapolatedRatio / measuredRatio).toBeGreaterThan(0.85)
    },
    120_000
  )
})
