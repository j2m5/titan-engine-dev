import type { HeightMapData } from './heightMapFormat'
import {
  CLEARANCE_GRID_BASE_SEGMENTS,
  CLEARANCE_MARGIN_METERS,
  TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS,
  TERRAIN_SAG_MODEL_VERSION
} from './TerrainHeightField'
import { TERRAIN_PATCH_SEGMENTS } from './cubeSphere'
import { TERRAIN_QUADTREE_MAX_LEVEL, TERRAIN_QUADTREE_MIN_LEVEL } from './terrainQuadtreeSelect'

/**
 * Производное состояние поля высот — то, что `TerrainHeightField` считает в
 * конструкторе за один проход по карте: сетка провиса, ε-пирамида уровней,
 * пирамида честных максимумов узлов. Всё это — ЧИСТАЯ функция от байтов карты
 * (радиус тела в неё не входит: от него зависит только `equatorTexelMeters`,
 * одно деление), поэтому считаться может один раз при сборке ассета, а не в
 * кадре, когда карта доехала.
 *
 * Тип общий для двух сторон: `TerrainHeightField.exportAux()` его отдаёт,
 * конструктор — принимает. Второй реализации формул НЕТ намеренно (в отличие
 * от slope-карт, где энкодер и GLSL-декод держатся ручной сверкой констант):
 * офлайн-скрипт строит настоящее поле и забирает у него готовые блоки, так
 * что запечённое равно вычисленному по построению.
 */
export type TerrainAuxPayload = {
  blocksX: number
  blocksY: number
  maxClearanceMeters: number
  maxSagMeters: number
  levelErrorMeters: Float64Array
  clearanceGrid: Float32Array
  /** null у КОНСТАНТНОГО поля (min === max) — см. докблок поля в TerrainHeightField. */
  nodeMaxHeightMetersPyramid: Float32Array | null
}

/**
 * Отпечаток карты, под которую посчитан компаньон. Ловит пару «компаньон от
 * прошлой версии карты» — единственный способ получить тихо неверный рельеф.
 *
 * Контрольная сумма — по РАЗРЕЖЁННОЙ выборке (~4096 отсчётов с постоянным
 * шагом), а не по всем текселям: полный проход по 33.5 млн значений стоил бы
 * десятки миллисекунд на загрузке — ровно того класса расхода, который этот
 * файл и убирает. Шаг выводится из длины, поэтому обрезанная или дописанная
 * карта меняет и выборку, и сумму.
 */
export type TerrainAuxFingerprint = {
  width: number
  height: number
  minMeters: number
  maxMeters: number
  checksum: number
}

/**
 * Калибровка, при которой блоки были посчитаны. Любая из этих величин входит
 * в формулу провиса или в раскладку пирамид: разойдись она с текущим кодом —
 * запечённые числа перестают что-либо означать.
 *
 * `sagModelVersion` отдельно от версии формата НЕ по недосмотру: сама формула
 * провиса может смениться при неизменной раскладке файла (ближайший кандидат —
 * сшивка узкой и широкой оценок на приполярной границе), и тогда протухают
 * данные, а не контейнер.
 */
export type TerrainAuxCalibration = {
  clearanceGridBaseSegments: number
  clearanceMarginMeters: number
  maxLevelEquatorSegments: number
  quadtreeMinLevel: number
  quadtreeMaxLevel: number
  patchSegments: number
  sagModelVersion: number
}

export type TerrainAuxData = TerrainAuxPayload & {
  fingerprint: TerrainAuxFingerprint
  calibration: TerrainAuxCalibration
}

/** Байты 'T','E','H','A' как u32 LE — компаньон карты 'TEHM'. */
export const TERRAIN_AUX_MAGIC = 0x41484554
export const TERRAIN_AUX_VERSION = 1

/**
 * Раскладка заголовка (little-endian). Смещения зафиксированы здесь и в
 * `scripts/lib/terrainAuxEncode.ts` — единственные два места, где они
 * упоминаются, и тест формата патчит байты по ним же.
 *
 * ```
 *  0 u32 magic          28 u32 clearanceGridBaseSegments   48 u32 blocksX
 *  4 u32 version        32 f32 clearanceMarginMeters       52 u32 blocksY
 *  8 u32 width          36 u32 maxLevelEquatorSegments     56 u32 levelCount
 * 12 u32 height         40 u16 quadtreeMinLevel            60 u32 pyramidCount
 * 16 f32 minMeters      42 u16 quadtreeMaxLevel            64 f64 maxClearanceMeters
 * 20 f32 maxMeters      44 u16 patchSegments               72 f64 maxSagMeters
 * 24 u32 checksum       46 u16 sagModelVersion             80 тело
 * ```
 *
 * 80 кратно 8: сразу за заголовком лежит f64-массив ε уровней, и вью на него
 * строится без копирования. Дальше f32-сетка и f32-пирамида — их смещения
 * кратны 4 при любом чётном levelCount.
 */
export const TERRAIN_AUX_HEADER_BYTES = 80

/** Отсчётов контрольной суммы: сумма считается по выборке, не по всей карте (см. докблок отпечатка). */
const CHECKSUM_SAMPLES = 4096

/**
 * Путь компаньона выводится из пути карты, а не хранится отдельной строкой
 * ресурса: компаньон — КЕШ карты, а не самостоятельный ассет, и раздваивать
 * их адресацию значит завести ещё одну пару, способную разъехаться (урок
 * `heightPathOf`). Заменяется расширение последнего сегмента; точка в
 * названии каталога расширением не считается.
 */
export function terrainAuxPathFor(heightPath: string): string {
  return heightPath.replace(/\.[^./\\]*$/, '') + '.aux'
}

/** Отпечаток карты — см. докблок типа. */
export function heightMapFingerprint(map: HeightMapData): TerrainAuxFingerprint {
  const { data } = map
  const stride = Math.max(1, Math.floor(data.length / CHECKSUM_SAMPLES))

  // FNV-1a по выборке: дешёвая свёртка без зависимостей, разрядность держится
  // Math.imul (обычное умножение ушло бы в f64 и потеряло младшие биты)
  let checksum = 0x811c9dc5
  for (let i = 0; i < data.length; i += stride) {
    checksum = Math.imul(checksum ^ data[i], 0x01000193)
  }
  checksum = Math.imul(checksum ^ data.length, 0x01000193)

  // Math.fround: границы диапазона в файле лежат как f32, и отпечаток,
  // посчитанный по f64-значению из памяти, иначе не сошёлся бы с прочитанным
  return {
    width: map.width,
    height: map.height,
    minMeters: Math.fround(map.minMeters),
    maxMeters: Math.fround(map.maxMeters),
    checksum: checksum >>> 0
  }
}

/** Текущая калибровка кода — эталон, с которым сверяется компаньон. */
export function currentTerrainAuxCalibration(): TerrainAuxCalibration {
  return {
    clearanceGridBaseSegments: CLEARANCE_GRID_BASE_SEGMENTS,
    clearanceMarginMeters: CLEARANCE_MARGIN_METERS,
    maxLevelEquatorSegments: TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS,
    quadtreeMinLevel: TERRAIN_QUADTREE_MIN_LEVEL,
    quadtreeMaxLevel: TERRAIN_QUADTREE_MAX_LEVEL,
    patchSegments: TERRAIN_PATCH_SEGMENTS,
    sagModelVersion: TERRAIN_SAG_MODEL_VERSION
  }
}

/**
 * Причина, по которой компаньон нельзя использовать, либо null. Строкой, а не
 * булем: вызывающий (`HeightFieldStorage`) пишет её в предупреждение — молчащий
 * фолбэк вернул бы секунду счёта в кадре, и никто бы не узнал почему.
 *
 * Расхождение НИКОГДА не даёт неверный рельеф: компаньон просто игнорируется,
 * и поле считает блоки сама, как до запечки.
 */
export function terrainAuxMismatch(aux: TerrainAuxData, map: HeightMapData): string | null {
  const expectedFingerprint = heightMapFingerprint(map)

  for (const key of Object.keys(expectedFingerprint) as (keyof TerrainAuxFingerprint)[]) {
    if (aux.fingerprint[key] !== expectedFingerprint[key]) {
      return `отпечаток карты не сходится (${key}: ${aux.fingerprint[key]} против ${expectedFingerprint[key]})`
    }
  }

  const expectedCalibration = currentTerrainAuxCalibration()

  for (const key of Object.keys(expectedCalibration) as (keyof TerrainAuxCalibration)[]) {
    if (aux.calibration[key] !== expectedCalibration[key]) {
      return `калибровка не сходится (${key}: ${aux.calibration[key]} против ${expectedCalibration[key]})`
    }
  }

  return null
}

/**
 * Зеркало `encodeTerrainAux` (scripts/lib) — паритет закреплён round-trip
 * тестом. Проверяет только СТРУКТУРУ (magic, версия, сходимость длин);
 * смысловая сверка с картой и с константами кода — `terrainAuxMismatch`,
 * её зовёт потребитель, у которого карта на руках.
 */
export function parseTerrainAux(buffer: ArrayBuffer): TerrainAuxData {
  if (buffer.byteLength < TERRAIN_AUX_HEADER_BYTES) {
    throw new Error(`Компаньон карты высот: файл короче заголовка (${buffer.byteLength} байт)`)
  }

  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)

  if (magic !== TERRAIN_AUX_MAGIC) {
    throw new Error(`Компаньон карты высот: неверный magic 0x${magic.toString(16)}`)
  }

  const version = view.getUint32(4, true)

  if (version !== TERRAIN_AUX_VERSION) {
    throw new Error(`Компаньон карты высот: неподдерживаемая версия ${version}`)
  }

  const blocksX = view.getUint32(48, true)
  const blocksY = view.getUint32(52, true)
  const levelCount = view.getUint32(56, true)
  const pyramidCount = view.getUint32(60, true)

  const levelBytes = levelCount * 8
  const gridBytes = blocksX * blocksY * 4
  const pyramidBytes = pyramidCount * 4
  const expectedBytes = TERRAIN_AUX_HEADER_BYTES + levelBytes + gridBytes + pyramidBytes

  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `Компаньон карты высот: размер тела не сходится (ожидалось ${expectedBytes}, получено ${buffer.byteLength})`
    )
  }

  const levelOffset = TERRAIN_AUX_HEADER_BYTES
  const gridOffset = levelOffset + levelBytes
  const pyramidOffset = gridOffset + gridBytes

  return {
    fingerprint: {
      width: view.getUint32(8, true),
      height: view.getUint32(12, true),
      minMeters: view.getFloat32(16, true),
      maxMeters: view.getFloat32(20, true),
      checksum: view.getUint32(24, true)
    },
    calibration: {
      clearanceGridBaseSegments: view.getUint32(28, true),
      clearanceMarginMeters: view.getFloat32(32, true),
      maxLevelEquatorSegments: view.getUint32(36, true),
      quadtreeMinLevel: view.getUint16(40, true),
      quadtreeMaxLevel: view.getUint16(42, true),
      patchSegments: view.getUint16(44, true),
      sagModelVersion: view.getUint16(46, true)
    },
    blocksX,
    blocksY,
    maxClearanceMeters: view.getFloat64(64, true),
    maxSagMeters: view.getFloat64(72, true),
    levelErrorMeters: new Float64Array(buffer, levelOffset, levelCount),
    clearanceGrid: new Float32Array(buffer, gridOffset, blocksX * blocksY),
    // Ноль записей — это КОНСТАНТНОЕ поле, у которого пирамиды нет вовсе, а не
    // пустой массив: `nodeMaxHeightMeters` различает эти случаи по null
    nodeMaxHeightMetersPyramid: pyramidCount > 0 ? new Float32Array(buffer, pyramidOffset, pyramidCount) : null
  }
}
