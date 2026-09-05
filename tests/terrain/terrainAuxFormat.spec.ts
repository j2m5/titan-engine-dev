import { describe, expect, it } from 'vitest'
import {
  TERRAIN_AUX_HEADER_BYTES,
  currentTerrainAuxCalibration,
  heightMapFingerprint,
  parseTerrainAux,
  terrainAuxMismatch,
  terrainAuxPathFor,
  type TerrainAuxPayload
} from '@/core/terrain/terrainAuxFormat'
import { TERRAIN_MODEL_LEVEL } from '@/core/terrain/terrainQuadtreeSelect'
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
    const parsed = parseTerrainAux(toArrayBuffer(encodeTerrainAux(payload(), source)))
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
  it('одна и та же карта — один и тот же отпечаток', () => {
    expect(heightMapFingerprint(map())).toEqual(heightMapFingerprint(map()))
  })

  it('изменение тела карты меняет контрольную сумму', () => {
    const changed = map()
    changed.data[0] = 12345

    expect(heightMapFingerprint(changed).checksum).not.toBe(heightMapFingerprint(map()).checksum)
  })

  it('изменение границ диапазона меняет отпечаток', () => {
    const changed = { ...map(), maxMeters: 10778 }

    expect(heightMapFingerprint(changed)).not.toEqual(heightMapFingerprint(map()))
  })
})

describe('terrainAuxMismatch: страж протухания', () => {
  it('свой компаньон своей карты — расхождения нет', () => {
    const source = map()
    const parsed = parseTerrainAux(toArrayBuffer(encodeTerrainAux(payload(), source)))

    expect(terrainAuxMismatch(parsed, source)).toBeNull()
  })

  it('компаньон от другой версии карты — расхождение по отпечатку', () => {
    const parsed = parseTerrainAux(toArrayBuffer(encodeTerrainAux(payload(), map())))
    const rebuilt = map()
    rebuilt.data[3] = 1

    expect(terrainAuxMismatch(parsed, rebuilt)).toMatch(/отпечат/i)
  })

  it('компаньон под другую калибровку — расхождение по калибровке', () => {
    const encoded = encodeTerrainAux(payload(), map())
    // смещение 28 — clearanceGridBaseSegments (см. раскладку в terrainAuxFormat)
    encoded.writeUInt32LE(777, 28)
    const parsed = parseTerrainAux(toArrayBuffer(encoded))

    expect(terrainAuxMismatch(parsed, map())).toMatch(/калибров/i)
  })

  it('компаньон под другую модель провиса — расхождение, даже когда карта та же', () => {
    const encoded = encodeTerrainAux(payload(), map())
    // смещение 46 — sagModelVersion (см. раскладку в terrainAuxFormat)
    encoded.writeUInt16LE(999, 46)
    const parsed = parseTerrainAux(toArrayBuffer(encoded))

    expect(terrainAuxMismatch(parsed, map())).toMatch(/калибров/i)
  })
})
