import { describe, expect, it } from 'vitest'
import {
  TERRAIN_AUX_HEADER_BYTES,
  TERRAIN_AUX_VERSION,
  currentTerrainAuxCalibration,
  heightMapFingerprint,
  parseTerrainAux,
  terrainAuxMismatch,
  terrainAuxPathFor,
  type TerrainAuxPayload
} from '@/core/terrain/terrainAuxFormat'
import { TERRAIN_MODEL_LEVEL } from '@/core/terrain/terrainQuadtreeSelect'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { encodeTerrainAux } from '../../scripts/lib/terrainAuxEncode'

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

function map(): HeightMapData {
  return {
    width: 4,
    height: 2,
    minMeters: -9150,
    maxMeters: 10777,
    data: new Uint16Array([0, 1000, 30000, 65535, 42, 7, 8, 9])
  }
}

function payload(withPyramid: boolean = true): TerrainAuxPayload {
  return {
    blocksX: 4,
    blocksY: 2,
    maxClearanceMeters: 1234.5,
    maxSagMeters: 1229.5,
    levelErrorMeters: new Float64Array([0, 100, 50, 25, 12.5, 6.25, 3.125]),
    clearanceGrid: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
    nodeMaxHeightMetersPyramid: withPyramid ? new Float32Array([10, 20, 30, 40]) : null,
    nodeErrorMetersPyramid: withPyramid ? new Float32Array([1, 2, 3, 4]) : null
  }
}

/** Фикстура принятия кеша: настоящая модель; payload выше проверяет только бинарный round-trip. */
function computedPayload(source: HeightMapData): TerrainAuxPayload {
  return new TerrainHeightField(source, 1, { ...MIDBAND_DEFAULTS, midbandStrength: 0 }).exportAux()
}

function parsedPayload(source: HeightMapData, aux: TerrainAuxPayload = computedPayload(source)) {
  return parseTerrainAux(toArrayBuffer(encodeTerrainAux(aux, source)))
}

describe('Формат компаньона карты высот: round-trip энкодер ↔ парсер', () => {
  it('encode → parse возвращает те же блоки поэлементно', () => {
    const source = payload()

    const parsed = parseTerrainAux(toArrayBuffer(encodeTerrainAux(source, map())))

    expect(parsed.blocksX).toBe(source.blocksX)
    expect(parsed.blocksY).toBe(source.blocksY)
    expect(parsed.maxClearanceMeters).toBe(source.maxClearanceMeters)
    expect(parsed.maxSagMeters).toBe(source.maxSagMeters)
    expect(Array.from(parsed.levelErrorMeters)).toEqual(Array.from(source.levelErrorMeters))
    expect(Array.from(parsed.clearanceGrid)).toEqual(Array.from(source.clearanceGrid))
    expect(Array.from(parsed.nodeMaxHeightMetersPyramid!)).toEqual(Array.from(source.nodeMaxHeightMetersPyramid!))
    expect(Array.from(parsed.nodeErrorMetersPyramid!)).toEqual(Array.from(source.nodeErrorMetersPyramid!))
  })

  it('отсутствие пирамиды (константное поле) переживает round-trip как null, а не как пустой массив', () => {
    const parsed = parseTerrainAux(toArrayBuffer(encodeTerrainAux(payload(false), map())))

    expect(parsed.nodeMaxHeightMetersPyramid).toBeNull()
    expect(parsed.nodeErrorMetersPyramid).toBeNull()
  })

  it('энкодер штампует отпечаток карты и текущую калибровку — их не передают снаружи', () => {
    const source = map()

    const parsed = parseTerrainAux(toArrayBuffer(encodeTerrainAux(payload(), source)))

    expect(parsed.fingerprint).toEqual(heightMapFingerprint(source))
    expect(parsed.calibration).toEqual(currentTerrainAuxCalibration())
  })

  // Task 5, фикс-раунд 1 (ревью): calibration.quadtreeMaxLevel несёт
  // TERRAIN_MODEL_LEVEL (уровень калибровки модели провиса/пирамид), а НЕ
  // TERRAIN_QUADTREE_MAX_LEVEL (потолок ОТБОРА узлов, вырос до 8) — иначе
  // подъём потолка отбора отбраковал бы ВСЕ существующие запечённые
  // компаньоны бакета (были посчитаны на модели L6). Раскладка байт та же
  // (u16 по смещению 42), меняется только семантика поля и значение.
  it('calibration.quadtreeMaxLevel — уровень модели (TERRAIN_MODEL_LEVEL=6), не потолок отбора узлов', () => {
    expect(currentTerrainAuxCalibration().quadtreeMaxLevel).toBe(TERRAIN_MODEL_LEVEL)

    const source = map()
    const parsed = parsedPayload(source)
    expect(parsed.calibration.quadtreeMaxLevel).toBe(TERRAIN_MODEL_LEVEL)
    // компаньон, посчитанный на текущей калибровке, обязан быть принят —
    // расхождения по калибровке нет (это и есть «существующие компаньоны
    // бакета остаются валидны», ревью Task 5 фикс-раунда 1)
    expect(terrainAuxMismatch(parsed, source)).toBeNull()
  })

  it('битый magic — ошибка с внятным сообщением', () => {
    const encoded = encodeTerrainAux(payload(), map())
    encoded.writeUInt32LE(0xdeadbeef, 0)

    expect(() => parseTerrainAux(toArrayBuffer(encoded))).toThrow(/magic/i)
  })

  it('чужая версия формата — ошибка, а не молчаливое чтение чужой раскладки', () => {
    const encoded = encodeTerrainAux(payload(), map())
    encoded.writeUInt32LE(999, 4)

    expect(() => parseTerrainAux(toArrayBuffer(encoded))).toThrow(/верси/i)
  })

  it('несовпадение длины тела с заявленными размерами блоков — ошибка', () => {
    const encoded = encodeTerrainAux(payload(), map())

    expect(() => parseTerrainAux(toArrayBuffer(encoded).slice(0, encoded.byteLength - 8))).toThrow(/размер/i)
  })

  it('обрезанный заголовок — ошибка', () => {
    expect(() => parseTerrainAux(new ArrayBuffer(TERRAIN_AUX_HEADER_BYTES - 1))).toThrow()
  })
})

describe('terrainAuxPathFor: путь компаньона выводится из пути карты', () => {
  it('расширение карты заменяется на .aux', () => {
    expect(terrainAuxPathFor('planets/moon/moon_height.raw')).toBe('planets/moon/moon_height.aux')
  })

  it('точки в каталогах не считаются расширением', () => {
    expect(terrainAuxPathFor('planets/star.wars/tatooine_height.raw')).toBe('planets/star.wars/tatooine_height.aux')
  })

  it('путь без расширения получает .aux, а не теряет последний сегмент', () => {
    expect(terrainAuxPathFor('planets/moon/moon_height')).toBe('planets/moon/moon_height.aux')
  })
})

describe('heightMapFingerprint: отпечаток карты', () => {
  it('формат 4 — двумерная выборка; компаньоны формата 3 отбрасываются по версии', () => {
    expect(TERRAIN_AUX_VERSION).toBe(4)
  })

  it('одна и та же карта — один и тот же отпечаток', () => {
    expect(heightMapFingerprint(map())).toEqual(heightMapFingerprint(map()))
  })

  it('изменение тела карты меняет контрольную сумму', () => {
    const changed = map()
    changed.data[0] = 12345

    expect(heightMapFingerprint(changed).checksum).not.toBe(heightMapFingerprint(map()).checksum)
  })

  // Выборка — сетка 256×256 со сдвигом строк: блок (W/256)×(H/256) текселей
  // где угодно обязан задеть отсчёт. Прежний шаг width+1 шёл одной диагональю
  // и на 8192×4096 не видел восточную половину карты вовсе.
  it('на карте 8192×4096 правка блока 32×16 в любом месте меняет сумму, включая восточное полушарие', () => {
    const width = 8192
    const height = 4096
    const base: HeightMapData = { width, height, minMeters: 0, maxMeters: 1000, data: new Uint16Array(width * height) }
    const baseChecksum = heightMapFingerprint(base).checksum
    for (const [x0, y0] of [[6000, 3000], [8160, 10], [4096, 2048], [7000, 100], [33, 4080], [5120, 1500]]) {
      const changed: HeightMapData = { ...base, data: new Uint16Array(base.data) }
      for (let y = y0; y < y0 + 16; y++) changed.data.fill(777, y * width + x0, y * width + x0 + 32)

      expect(heightMapFingerprint(changed).checksum, `блок в (${x0}, ${y0})`).not.toBe(baseChecksum)
    }
  })

  it('карта уже 256 текселей: каждая строка в выборке, правка одного текселя ловится', () => {
    const width = 6000
    const height = 10
    const base: HeightMapData = { width, height, minMeters: 0, maxMeters: 1000, data: new Uint16Array(width * height) }
    const baseChecksum = heightMapFingerprint(base).checksum
    for (let y = 0; y < height; y++) {
      const changed: HeightMapData = { ...base, data: new Uint16Array(base.data) }
      changed.data.fill(777, y * width + 4000, y * width + 4000 + Math.ceil(width / 256))

      expect(heightMapFingerprint(changed).checksum).not.toBe(baseChecksum)
    }
  })

  it('изменение границ диапазона меняет отпечаток', () => {
    const changed = { ...map(), maxMeters: 10778 }

    expect(heightMapFingerprint(changed)).not.toEqual(heightMapFingerprint(map()))
  })
})

describe('terrainAuxMismatch: страж протухания', () => {
  it('свой компаньон своей карты — расхождения нет', () => {
    const source = map()
    const parsed = parsedPayload(source)

    expect(terrainAuxMismatch(parsed, source)).toBeNull()
  })

  it('компаньон от другой версии карты — расхождение по отпечатку', () => {
    const parsed = parsedPayload(map())
    const rebuilt = map()
    rebuilt.data[3] = 1

    expect(terrainAuxMismatch(parsed, rebuilt)).toMatch(/отпечат/i)
  })

  it('компаньон под другую калибровку — расхождение по калибровке', () => {
    const source = map()
    const encoded = encodeTerrainAux(computedPayload(source), source)
    // смещение 28 — clearanceGridBaseSegments (см. раскладку в terrainAuxFormat)
    encoded.writeUInt32LE(777, 28)
    const parsed = parseTerrainAux(toArrayBuffer(encoded))

    expect(terrainAuxMismatch(parsed, map())).toMatch(/калибров/i)
  })

  it('компаньон под другую модель провиса — расхождение, даже когда карта та же', () => {
    const source = map()
    const encoded = encodeTerrainAux(computedPayload(source), source)
    // смещение 46 — sagModelVersion (см. раскладку в terrainAuxFormat)
    encoded.writeUInt16LE(999, 46)
    const parsed = parseTerrainAux(toArrayBuffer(encoded))

    expect(terrainAuxMismatch(parsed, map())).toMatch(/калибров/i)
  })
})

describe('terrainAuxMismatch: форма данных должна соответствовать карте и текущей модели', () => {
  const source = map()
  const valid = computedPayload(source)

  it.each([
    ['пустая таблица ошибок', { levelErrorMeters: new Float64Array(0) }],
    ['короткая таблица ошибок', { levelErrorMeters: valid.levelErrorMeters.slice(1) }],
    ['лишний уровень ошибок', { levelErrorMeters: new Float64Array(valid.levelErrorMeters.length + 1) }],
    ['нулевая ширина сетки', { blocksX: 0, clearanceGrid: new Float32Array(0) }],
    ['другая ширина сетки', { blocksX: 5, clearanceGrid: new Float32Array(10) }],
    ['нулевая высота сетки', { blocksY: 0, clearanceGrid: new Float32Array(0) }],
    ['другая высота сетки', { blocksY: 3, clearanceGrid: new Float32Array(12) }],
    ['нет пирамид обычной карты', { nodeMaxHeightMetersPyramid: null, nodeErrorMetersPyramid: null }],
    ['короткие пирамиды', { nodeMaxHeightMetersPyramid: new Float32Array(4), nodeErrorMetersPyramid: new Float32Array(4) }]
  ])('%s: контейнер и отпечаток валидны, но кеш отвергается', (_name, changed) => {
    // Реальный путь загрузки: encode -> parse сохраняет длину контейнера,
    // отпечаток и калибровку; именно принятие кеша обязано заметить чужую форму.
    const parsed = parsedPayload(source, { ...valid, ...changed })
    expect(parsed.fingerprint).toEqual(heightMapFingerprint(source))
    expect(parsed.calibration).toEqual(currentTerrainAuxCalibration())
    expect(terrainAuxMismatch(parsed, source)).not.toBeNull()
  })

  it('неполный массив сетки и одна отсутствующая пирамида не принимаются', () => {
    const parsed = parsedPayload(source, valid)
    expect(terrainAuxMismatch({ ...parsed, clearanceGrid: new Float32Array(0) }, source)).not.toBeNull()
    expect(terrainAuxMismatch({ ...parsed, nodeMaxHeightMetersPyramid: null }, source)).not.toBeNull()
    expect(terrainAuxMismatch({ ...parsed, nodeErrorMetersPyramid: null }, source)).not.toBeNull()
    expect(terrainAuxMismatch({ ...parsed, nodeErrorMetersPyramid: new Float32Array(4) }, source)).not.toBeNull()
  })

  it('константная карта принимает модель без пирамид, а лишние пирамиды отвергает', () => {
    const constant = { ...source, minMeters: 123, maxMeters: 123 }
    const own = computedPayload(constant)
    expect(terrainAuxMismatch(parsedPayload(constant, own), constant)).toBeNull()
    const withPyramids = {
      ...own,
      nodeMaxHeightMetersPyramid: valid.nodeMaxHeightMetersPyramid,
      nodeErrorMetersPyramid: valid.nodeErrorMetersPyramid
    }
    expect(terrainAuxMismatch(parsedPayload(constant, withPyramids), constant)).not.toBeNull()
  })
})
