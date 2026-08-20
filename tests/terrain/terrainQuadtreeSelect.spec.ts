import { describe, expect, it } from 'vitest'
import { Frustum, Matrix4, PerspectiveCamera, Vector2, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { cubeFaceDirection } from '@/core/terrain/cubeSphere'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import {
  selectTerrainNodes,
  terrainNodeKey,
  nodeBoundingSphereRadiusUnits,
  TERRAIN_QUADTREE_WATER_CEILING_LEVEL,
  TERRAIN_QUADTREE_MAX_LEVEL,
  type SelectParams,
  type TerrainNodeAddress
} from '@/core/terrain/terrainQuadtreeSelect'

function makeMap(width: number, height: number, values: number[], minMeters = 0, maxMeters = 65535): HeightMapData {
  return { width, height, minMeters, maxMeters, data: new Uint16Array(values) }
}

const R_KM = 1736

// Чекерборд высот, не константа: геометрическая ошибка TerrainHeightField —
// это варианс высот в окне (p99 размаха), у константной карты (h=0 всюду)
// он тождественно 0 на ВСЕХ уровнях — SSE-порог тогда не пробивается никогда,
// набор листьев не растёт ни при каком приближении камеры. Крупная амплитуда
// (уровни 3-6 линейно уменьшаются форматом блочного затухания карты 8×4 —
// на порядки от исходной) держит sse пробиваемым вплоть до дальних дистанций,
// нужных тесту фрустума (см. ниже).
const HEIGHT_AMPLITUDE_METERS = 20000

function flatField(): TerrainHeightField {
  const values: number[] = []
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) values.push(((col + row) % 2) * HEIGHT_AMPLITUDE_METERS)
  }

  return new TerrainHeightField(makeMap(8, 4, values, 0, 65535), R_KM)
}

function makeParams(altKm: number, over: Partial<SelectParams> = {}): SelectParams {
  const field = flatField()
  const r = field.surfaceRadiusUnits(new Vector3(1, 0, 0))

  return {
    field,
    cameraLocal: new Vector3(r + toThreeJSUnits(altKm), 0, 0),
    frustumLocal: null,
    screenHeight: 1080,
    fovYRadians: (50 * Math.PI) / 180,
    splitPixels: 6,
    mergeFactor: 0.7,
    currentlySplit: new Set<string>(),
    ...over
  }
}

describe('selectTerrainNodes: SSE-отбор узлов квадродерева', () => {
  it('издалека — минимальный набор уровня 1 (24 листа), покрытие полное', () => {
    const { leaves } = selectTerrainNodes(makeParams(500000))
    expect(leaves).toHaveLength(24)
    expect(new Set(leaves.map(terrainNodeKey)).size).toBe(24)
    expect(leaves.every((a) => a.level === 1)).toBe(true)
  })

  it('приближение увеличивает набор, сумма покрытия сохраняется', () => {
    const far = selectTerrainNodes(makeParams(50000)).leaves
    const near = selectTerrainNodes(makeParams(50)).leaves
    expect(near.length).toBeGreaterThan(far.length)
    // покрытие: сумма 4^{-level} по листьям = 6 корней... уровень ≥1: сумма (1/4)^{level-1} по листьям одной грани = 4? Проверяем инвариант площади:
    const coverage = (ls: TerrainNodeAddress[]): number => ls.reduce((s, a) => s + 4 ** -(a.level - 1), 0)
    expect(coverage(near)).toBeCloseTo(24, 10)
    expect(coverage(far)).toBeCloseTo(24, 10)
  })

  it('потолок глубины 6 держится вплотную к поверхности', () => {
    const { leaves } = selectTerrainNodes(makeParams(0.2))
    expect(Math.max(...leaves.map((a) => a.level))).toBe(6)
  })

  it('гистерезис: между τ_merge и τ_split разбитый узел не схлопывается, kMerge реально применяется', () => {
    // Высоты подобраны эмпирически под HEIGHT_AMPLITUDE_METERS=20000 и splitPixels=6:
    // на ALT_SPLIT четыре пограничных узла face=0 уровня 1 имеют sse≈6.34-6.35 (>
    // splitPixels=6) — реально разбиваются с пустой историей. На ALT_MERGE_ZONE
    // (дальше — камера отодвинута) те же четыре узла имеют sse≈5.585-5.591: НИЖЕ
    // splitPixels=6 (без истории схлопнулись бы), но ВЫШЕ splitPixels·mergeFactor=
    // 6·0.7=4.2 (с историей остаются разбитыми) — ровно зона гистерезиса. (Числа
    // пересчитаны Task 5: консервативная сфера узла увеличила радиус и слегка
    // подняла sse на обеих высотах — тот же диапазон между τ·0.7 и τ сохранился,
    // сами ALT_SPLIT/ALT_MERGE_ZONE не менялись.)
    const ALT_SPLIT = 4500
    const ALT_MERGE_ZONE = 5000

    const runA = selectTerrainNodes(makeParams(ALT_SPLIT))
    expect(runA.split.size).toBeGreaterThan(0) // непустой сплит — тест не вырожден

    // (б) та же карта, дальше камера, история из A, порог по умолчанию (kMerge=0.7):
    // пограничные узлы обязаны остаться разбитыми — набор идентичен A
    const withHysteresis = selectTerrainNodes(makeParams(ALT_MERGE_ZONE, { currentlySplit: runA.split }))
    expect(new Set(withHysteresis.leaves.map(terrainNodeKey))).toEqual(new Set(runA.leaves.map(terrainNodeKey)))

    // (в) та же высота и та же история, но kMerge=1 (порог схлопывания = порог
    // разбиения — гистерезис нейтрализован): пограничные узлы схлопываются,
    // результат совпадает с чистым пересчётом без всякой истории
    const withoutHysteresis = selectTerrainNodes(makeParams(ALT_MERGE_ZONE, { currentlySplit: runA.split, mergeFactor: 1 }))
    const fresh = selectTerrainNodes(makeParams(ALT_MERGE_ZONE))
    expect(new Set(withoutHysteresis.leaves.map(terrainNodeKey))).toEqual(new Set(fresh.leaves.map(terrainNodeKey)))

    // (б) ↔ (в): разница доказывает, что kMerge действительно применяется, а не
    // просто демонстрирует детерминизм чистой функции
    expect(withHysteresis.leaves.length).toBeGreaterThan(withoutHysteresis.leaves.length)
  })

  it('вне фрустума не сплитится', () => {
    // фрустум, смотрящий строго от планеты: все узлы вне → набор минимальный несмотря на близость.
    // Высота 1000 км, не 50: сфера отбора узла уровня 1 — половина диагонали
    // дуги патча (см. selectTerrainNodes) — на грубом уровне 1 огромна (~R/2),
    // при высоте 50 км камера физически ВНУТРИ этой сферы и частично видна
    // при любом развороте; 1000 км выносит камеру за пределы сферы, оставляя
    // геометрию по-прежнему «близкой» для SSE (без фрустума набор кратно больше 24)
    const params = makeParams(1000)
    const frustum = new Frustum()
    const away = new PerspectiveCamera(50, 1, 0.001, 1e9)
    away.position.copy(params.cameraLocal)
    away.lookAt(params.cameraLocal.clone().multiplyScalar(2)) // взгляд от тела
    away.updateMatrixWorld(true)
    frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(away.projectionMatrix, away.matrixWorldInverse))
    const { leaves } = selectTerrainNodes({ ...params, frustumLocal: frustum })
    expect(leaves).toHaveLength(24)
  })

  it('гистерезис вне фрустума: уже разбитый узел остаётся разбитым, когда камера отворачивается', () => {
    // Кадр А: камера смотрит на тело с 1000 км без фрустума — набор глубже 24.
    const params = makeParams(1000)
    const runA = selectTerrainNodes(params)
    expect(runA.leaves.length).toBeGreaterThan(24)

    // Кадр Б: та же позиция, взгляд от тела (все узлы вне фрустума), история из А.
    const frustum = new Frustum()
    const away = new PerspectiveCamera(50, 1, 0.001, 1e9)
    away.position.copy(params.cameraLocal)
    away.lookAt(params.cameraLocal.clone().multiplyScalar(2))
    away.updateMatrixWorld(true)
    frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(away.projectionMatrix, away.matrixWorldInverse))

    const runB = selectTerrainNodes({ ...params, frustumLocal: frustum, currentlySplit: runA.split })
    expect(new Set(runB.leaves.map(terrainNodeKey))).toEqual(new Set(runA.leaves.map(terrainNodeKey)))

    // Контроль: без истории тот же кадр Б схлопывается до 24 — тест дискриминирует.
    const fresh = selectTerrainNodes({ ...params, frustumLocal: frustum })
    expect(fresh.leaves).toHaveLength(24)
  })

  it('камера под поверхностью не роняет отбор (кламп дистанции)', () => {
    const { leaves } = selectTerrainNodes(makeParams(-5))
    expect(leaves.length).toBeGreaterThan(24)
    expect(leaves.every((a) => Number.isFinite(a.level))).toBe(true)
  })
})

describe('сфера узла консервативна: все вершины патча внутри (угол грани, размах высот)', () => {
  const field = flatField() // чекерборд 0/20000 м — размах максимальный

  for (const level of [1, 2, 4, 6]) {
    it(`уровень ${level}: угловой узел (i=j=0) грани 0`, () => {
      const patches = 2 ** level
      const span = 2 / patches
      const sc = -1 + span / 2
      const tc = -1 + span / 2
      const centerDir = cubeFaceDirection(0, sc, tc, new Vector3())
      const centerHeight = field.heightMeters(centerDir)
      const center = centerDir.clone().multiplyScalar(toThreeJSUnits(field.radiusKm + centerHeight / 1000))
      const radius = nodeBoundingSphereRadiusUnits(field, level, centerHeight)

      let maxDist = 0
      for (let v = 0; v <= 64; v++) {
        for (let u = 0; u <= 64; u++) {
          const s = -1 + (u / 64) * span
          const t = -1 + (v / 64) * span
          const dir = cubeFaceDirection(0, s, t, new Vector3())
          // худший случай по высоте — вершина на максимуме/минимуме карты
          for (const h of [field.minMeters, field.maxMeters]) {
            const p = dir.clone().multiplyScalar(toThreeJSUnits(field.radiusKm + h / 1000))
            maxDist = Math.max(maxDist, p.distanceTo(center))
          }
        }
      }

      expect(maxDist).toBeLessThanOrEqual(radius)
    })
  }
})

// Task 5 (water-foundation): узел, чей оценённый максимум высоты уверенно
// ниже уровня воды, дальше TERRAIN_QUADTREE_WATER_CEILING_LEVEL не делится.
// Два ОДНОРОДНЫХ полушария (не чекерборд — см. WATER_TERRAIN_PATH в
// CameraCollision.spec.ts, тот же урок: соседние текселя чекерборда сами
// несут огромную ε даже вдали от границы): запад (col 0..31) — океан
// (−25000/−15000 м), восток (col 32..63) — суша (15000/25000 м), лёгкий
// чекерборд ВНУТРИ каждой половины (амплитуда 10000) держит ε-пирамиду
// ненулевой (см. комментарий HEIGHT_AMPLITUDE_METERS у flatField выше — без
// вариации SSE не пробивает порог вовсе).
const WATER_WIDTH = 64
const WATER_HEIGHT = 4
const OCEAN_LOW = -25000
const OCEAN_HIGH = -15000
const LAND_LOW = 15000
const LAND_HIGH = 25000

const WATER_MIN_METERS = -40000
const WATER_MAX_METERS = 40000
// Uint16Array хранит RAW-код (0..65535), не метры напрямую — минус/максимум
// карты кодируют интерполяцию, отрицательные метры нельзя писать в raw как
// есть (переполнение). rawFor — точная обратная формула к sampleMeters.
const rawFor = (meters: number): number => Math.round(((meters - WATER_MIN_METERS) / (WATER_MAX_METERS - WATER_MIN_METERS)) * 65535)

function waterField(): TerrainHeightField {
  const values: number[] = []
  for (let row = 0; row < WATER_HEIGHT; row++) {
    for (let col = 0; col < WATER_WIDTH; col++) {
      const checker = (col + row) % 2 === 0
      const isOcean = col < WATER_WIDTH / 2
      const meters = isOcean ? (checker ? OCEAN_LOW : OCEAN_HIGH) : checker ? LAND_LOW : LAND_HIGH
      values.push(rawFor(meters))
    }
  }
  return new TerrainHeightField(makeMap(WATER_WIDTH, WATER_HEIGHT, values, WATER_MIN_METERS, WATER_MAX_METERS), R_KM)
}

// центры текселей вдали от границы полушарий (col=31/32) и от шва долготы
// (col=0/63) — та же обратная формула dirToUv, что и в CameraCollision.spec.ts
const dirAtWaterCol = (col: number): Vector3 => {
  const phi = ((col + 0.5) / WATER_WIDTH) * 2 * Math.PI
  return new Vector3(-Math.cos(phi), 0, Math.sin(phi))
}
const OCEAN_INTERIOR_DIR = dirAtWaterCol(16)
const LAND_INTERIOR_DIR = dirAtWaterCol(48)

function waterParamsAt(field: TerrainHeightField, dir: Vector3, altKm: number, waterLevelMeters: number | undefined): SelectParams {
  const r = field.surfaceRadiusUnits(dir)

  return {
    field,
    cameraLocal: dir.clone().multiplyScalar(r + toThreeJSUnits(altKm)),
    frustumLocal: null,
    screenHeight: 1080,
    fovYRadians: (50 * Math.PI) / 180,
    splitPixels: 6,
    mergeFactor: 0.7,
    currentlySplit: new Set<string>(),
    waterLevelMeters
  }
}

describe('selectTerrainNodes: SSE-потолок подводных патчей суши (Task 5, water-foundation)', () => {
  it('океан вдали от берега не делится глубже потолка, хотя камера вплотную', () => {
    const field = waterField()
    const { leaves } = selectTerrainNodes(waterParamsAt(field, OCEAN_INTERIOR_DIR, 0.2, 0))

    expect(Math.max(...leaves.map((a) => a.level))).toBe(TERRAIN_QUADTREE_WATER_CEILING_LEVEL)
  })

  it('суша вдали от берега делится честно до полного потолка дерева — вода её не ограничивает', () => {
    const field = waterField()
    const { leaves } = selectTerrainNodes(waterParamsAt(field, LAND_INTERIOR_DIR, 0.2, 0))

    expect(Math.max(...leaves.map((a) => a.level))).toBe(TERRAIN_QUADTREE_MAX_LEVEL)
  })

  it('без ручки waterLevelMeters — потолок не действует вовсе (бит-в-бит): тот же океанский узел делится до предела', () => {
    const field = waterField()
    const { leaves } = selectTerrainNodes(waterParamsAt(field, OCEAN_INTERIOR_DIR, 0.2, undefined))

    expect(Math.max(...leaves.map((a) => a.level))).toBe(TERRAIN_QUADTREE_MAX_LEVEL)
  })
})

// Финальное ревью water-foundation, находка №1 (БЛОКЕР): запас потолка обязан
// быть ≥ WATER_SHALLOW_RANGE_METERS (диапазон мелководья канала A) — иначе
// узел, чей честный максимум лежит МЕЖДУ старым запасом (50 м) и диапазоном
// мелководья (200 м), замерзает под ещё ЧАСТИЧНО ПРОЗРАЧНОЙ водой (альфа
// плавно растёт 0→1 на этом диапазоне, не 0/1-скачком на границе запаса).
// Тот же профиль ocean/land, что и waterField() выше, но с параметризуемым
// пиком океана — изолирует именно порог запаса, а не форму карты.
function waterFieldWithOceanHigh(oceanHigh: number): TerrainHeightField {
  const oceanLow = oceanHigh - 10000 // та же амплитуда 10000, что у LAND_HIGH−LAND_LOW — гарантирует непустой ε на всех уровнях (см. HEIGHT_AMPLITUDE_METERS выше)
  const values: number[] = []
  for (let row = 0; row < WATER_HEIGHT; row++) {
    for (let col = 0; col < WATER_WIDTH; col++) {
      const checker = (col + row) % 2 === 0
      const isOcean = col < WATER_WIDTH / 2
      const meters = isOcean ? (checker ? oceanLow : oceanHigh) : checker ? LAND_LOW : LAND_HIGH
      values.push(rawFor(meters))
    }
  }
  return new TerrainHeightField(makeMap(WATER_WIDTH, WATER_HEIGHT, values, WATER_MIN_METERS, WATER_MAX_METERS), R_KM)
}

describe('selectTerrainNodes: запас SSE-потолка ≥ диапазона мелководья (Task 5, финальное ревью, находка №1)', () => {
  it('честный максимум узла на 100 м ниже уровня (внутри мелководья, вода ещё прозрачна) — узел НЕ замораживается', () => {
    const field = waterFieldWithOceanHigh(-100) // уровень 0 − 100 м
    const { leaves } = selectTerrainNodes(waterParamsAt(field, OCEAN_INTERIOR_DIR, 0.2, 0))

    expect(Math.max(...leaves.map((a) => a.level))).toBe(TERRAIN_QUADTREE_MAX_LEVEL)
  })

  it('честный максимум узла на 250 м ниже уровня (глубже мелководья, вода непрозрачна) — узел замораживается на потолке', () => {
    const field = waterFieldWithOceanHigh(-250) // уровень 0 − 250 м
    const { leaves } = selectTerrainNodes(waterParamsAt(field, OCEAN_INTERIOR_DIR, 0.2, 0))

    expect(Math.max(...leaves.map((a) => a.level))).toBe(TERRAIN_QUADTREE_WATER_CEILING_LEVEL)
  })
})

// Ревью Task 5, фикс-раунд 1, находка №1/№4: СМЕШАННЫЙ узел (центр в океане,
// у КРАЯ — остров выше уровня воды) — ровно случай, где статистическая
// оценка «центр+k·ε» недооценивает максимум узла (замер ревью на реальной
// карте: узел с Гавайями, недооценка 7.4 км, 211 замороженных прибрежных
// узлов). Целевой узел — face=0, level=4 (потолок), i=5, j=5: его bbox в UV
// вычислен той же геометрией, что билдер пирамиды в TerrainHeightField
// (cubeFaceDirection + dirToUv, 9 сэмплов узла) — остров кладётся у ДАЛЬНЕГО
// (uHi) края узла, заведомо не в центре сэмпла. Без честного пер-узлового
// максимума узел обязан заморозиться на уровне 4 несмотря на остров (RED);
// с честным максимумом (bbox → блоки clearance-сетки) — обязан продолжить
// деление вглубь.
describe('selectTerrainNodes: честный максимум узла ловит остров у края (Task 5, фикс-раунд 1, находка №1/№4)', () => {
  const ISLAND_FACE = 0
  const ISLAND_LEVEL = 4
  const ISLAND_I = 5
  const ISLAND_J = 5
  const ISLAND_WIDTH = 512
  const ISLAND_HEIGHT = 256
  const ISLAND_MIN_M = -40000
  const ISLAND_MAX_M = 40000
  const ISLAND_OCEAN_LOW = -25000
  const ISLAND_OCEAN_HIGH = -15000
  const ISLAND_PEAK_METERS = 500 // выше уровня воды (0)
  const ISLAND_TEXEL_RADIUS = 2

  const islandRawFor = (meters: number): number =>
    Math.round(((meters - ISLAND_MIN_M) / (ISLAND_MAX_M - ISLAND_MIN_M)) * 65535)

  // bbox узла в UV той же геометрией, что билдер пирамиды (9 сэмплов — 4 угла
  // + 4 середины рёбер + центр, циклический анврап долготы относительно
  // центра) — поле-затычка нужно только ради dirToUv, чистой геометрии без
  // обращения к данным карты
  function nodeBBoxUV(scratchField: TerrainHeightField, face: number, level: number, i: number, j: number) {
    const patches = 2 ** level
    const span = 2 / patches
    const sLo = -1 + i * span
    const sHi = sLo + span
    const tLo = -1 + j * span
    const tHi = tLo + span
    const sMid = (sLo + sHi) / 2
    const tMid = (tLo + tHi) / 2
    const sSamples = [sLo, sHi, sLo, sHi, sMid, sMid, sLo, sHi, sMid]
    const tSamples = [tLo, tLo, tHi, tHi, tLo, tHi, tMid, tMid, tMid]

    const dirScratch = new Vector3()
    const uvScratch = new Vector2()
    const us: number[] = []
    const vs: number[] = []
    for (let k = 0; k < 9; k++) {
      cubeFaceDirection(face, sSamples[k], tSamples[k], dirScratch)
      scratchField.dirToUv(dirScratch, uvScratch)
      us.push(uvScratch.x)
      vs.push(uvScratch.y)
    }
    const centerU = us[8]
    let uLo = Infinity
    let uHi = -Infinity
    let vLo = Infinity
    let vHi = -Infinity
    for (let k = 0; k < 9; k++) {
      let u = us[k]
      const d = u - centerU
      if (d > 0.5) u -= 1
      else if (d < -0.5) u += 1
      if (u < uLo) uLo = u
      if (u > uHi) uHi = u
      if (vs[k] < vLo) vLo = vs[k]
      if (vs[k] > vHi) vHi = vs[k]
    }
    return { uLo, uHi, vLo, vHi, centerV: vs[8] }
  }

  function islandField(): TerrainHeightField {
    const scratchField = new TerrainHeightField(makeMap(4, 2, [0, 0, 0, 0, 0, 0, 0, 0]), R_KM)
    const bbox = nodeBBoxUV(scratchField, ISLAND_FACE, ISLAND_LEVEL, ISLAND_I, ISLAND_J)

    const islandU = bbox.uHi - (bbox.uHi - bbox.uLo) * 0.1 // у дальнего края, не в центре
    const islandCol = Math.round((((islandU % 1) + 1) % 1) * ISLAND_WIDTH)
    const islandRow = Math.round(bbox.centerV * ISLAND_HEIGHT)

    const values: number[] = []
    for (let row = 0; row < ISLAND_HEIGHT; row++) {
      for (let col = 0; col < ISLAND_WIDTH; col++) {
        const nearIsland = Math.abs(col - islandCol) <= ISLAND_TEXEL_RADIUS && Math.abs(row - islandRow) <= ISLAND_TEXEL_RADIUS
        const checker = (col + row) % 2 === 0
        const meters = nearIsland ? ISLAND_PEAK_METERS : checker ? ISLAND_OCEAN_LOW : ISLAND_OCEAN_HIGH
        values.push(islandRawFor(meters))
      }
    }

    return new TerrainHeightField(makeMap(ISLAND_WIDTH, ISLAND_HEIGHT, values, ISLAND_MIN_M, ISLAND_MAX_M), R_KM)
  }

  it('узел с островом у края продолжает делиться глубже потолка (не замораживается)', () => {
    const field = islandField()

    const patches = 2 ** ISLAND_LEVEL
    const span = 2 / patches
    const sc = -1 + ISLAND_I * span + span / 2
    const tc = -1 + ISLAND_J * span + span / 2
    const centerDir = new Vector3()
    cubeFaceDirection(ISLAND_FACE, sc, tc, centerDir)
    const r = field.surfaceRadiusUnits(centerDir)

    const { leaves } = selectTerrainNodes({
      field,
      cameraLocal: centerDir.clone().multiplyScalar(r + toThreeJSUnits(0.05)),
      frustumLocal: null,
      screenHeight: 1080,
      fovYRadians: (50 * Math.PI) / 180,
      splitPixels: 6,
      mergeFactor: 0.7,
      currentlySplit: new Set<string>(),
      waterLevelMeters: 0
    })

    // сам целевой узел НЕ должен остаться листом — под островом он обязан
    // продолжить деление (без честного максимума узел замерзает здесь —
    // RED, воспроизведено откатом на «центр+k·ε» при ревью)
    const targetKey = terrainNodeKey({ face: ISLAND_FACE, level: ISLAND_LEVEL, i: ISLAND_I, j: ISLAND_J })
    expect(leaves.some((a) => terrainNodeKey(a) === targetKey)).toBe(false)

    const descendants = leaves.filter((a) => {
      if (a.face !== ISLAND_FACE || a.level <= ISLAND_LEVEL) return false
      const delta = a.level - ISLAND_LEVEL
      return a.i >> delta === ISLAND_I && a.j >> delta === ISLAND_J
    })
    expect(descendants.length).toBeGreaterThan(0)
  })
})
