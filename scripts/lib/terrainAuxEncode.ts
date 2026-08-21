import { Buffer } from 'node:buffer'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import {
  TERRAIN_AUX_HEADER_BYTES,
  TERRAIN_AUX_MAGIC,
  TERRAIN_AUX_VERSION,
  currentTerrainAuxCalibration,
  heightMapFingerprint,
  type TerrainAuxPayload
} from '@/core/terrain/terrainAuxFormat'

/**
 * Радиус, с которым офлайн-сборка строит поле высот ради его блоков.
 * Условный и таким и должен быть: ни одна запечённая величина от радиуса не
 * зависит (`equatorTexelMeters` — единственная радиусозависимая, считается в
 * рантайме по настоящему радиусу тела и в компаньон не входит). Инвариант
 * закреплён тестом «запечённые блоки не зависят от радиуса тела» — без него
 * запечка пер-карту была бы неверна для карт, шаренных телами разных
 * радиусов.
 */
export const AUX_BAKE_RADIUS_KM = 1

/** Копия типизированного массива в буфер по смещению — платформа little-endian, как и в encodeHeightMap. */
function writeArray(target: Buffer, source: Float32Array | Float64Array, offset: number): number {
  Buffer.from(source.buffer, source.byteOffset, source.byteLength).copy(target, offset)

  return offset + source.byteLength
}

/**
 * Зеркало `parseTerrainAux` — паритет закреплён round-trip тестом.
 *
 * Отпечаток карты и калибровку энкодер штампует САМ, из карты и из текущих
 * констант кода: передавать их аргументом значило бы разрешить вызывающему
 * подписать блоки чужим отпечатком, а весь смысл этих двух полей — поймать
 * ровно такое расхождение.
 */
export function encodeTerrainAux(payload: TerrainAuxPayload, map: HeightMapData): Buffer {
  const fingerprint = heightMapFingerprint(map)
  const calibration = currentTerrainAuxCalibration()
  const pyramid = payload.nodeMaxHeightMetersPyramid

  const buffer = Buffer.alloc(
    TERRAIN_AUX_HEADER_BYTES +
      payload.levelErrorMeters.byteLength +
      payload.clearanceGrid.byteLength +
      (pyramid?.byteLength ?? 0) * 2
  )

  buffer.writeUInt32LE(TERRAIN_AUX_MAGIC, 0)
  buffer.writeUInt32LE(TERRAIN_AUX_VERSION, 4)

  buffer.writeUInt32LE(fingerprint.width, 8)
  buffer.writeUInt32LE(fingerprint.height, 12)
  buffer.writeFloatLE(fingerprint.minMeters, 16)
  buffer.writeFloatLE(fingerprint.maxMeters, 20)
  buffer.writeUInt32LE(fingerprint.checksum, 24)

  buffer.writeUInt32LE(calibration.clearanceGridBaseSegments, 28)
  buffer.writeFloatLE(calibration.clearanceMarginMeters, 32)
  buffer.writeUInt32LE(calibration.maxLevelEquatorSegments, 36)
  buffer.writeUInt16LE(calibration.quadtreeMinLevel, 40)
  buffer.writeUInt16LE(calibration.quadtreeMaxLevel, 42)
  buffer.writeUInt16LE(calibration.patchSegments, 44)
  buffer.writeUInt16LE(calibration.sagModelVersion, 46)

  buffer.writeUInt32LE(payload.blocksX, 48)
  buffer.writeUInt32LE(payload.blocksY, 52)
  buffer.writeUInt32LE(payload.levelErrorMeters.length, 56)
  buffer.writeUInt32LE(pyramid?.length ?? 0, 60)
  buffer.writeDoubleLE(payload.maxClearanceMeters, 64)
  buffer.writeDoubleLE(payload.maxSagMeters, 72)

  let offset = writeArray(buffer, payload.levelErrorMeters, TERRAIN_AUX_HEADER_BYTES)
  offset = writeArray(buffer, payload.clearanceGrid, offset)
  if (pyramid) offset = writeArray(buffer, pyramid, offset)
  if (payload.nodeErrorMetersPyramid) writeArray(buffer, payload.nodeErrorMetersPyramid, offset)

  return buffer
}
