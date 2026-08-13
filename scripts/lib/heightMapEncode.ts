import { Buffer } from 'node:buffer'
import {
  HEIGHT_MAP_HEADER_BYTES,
  HEIGHT_MAP_MAGIC,
  HEIGHT_MAP_VERSION,
  type HeightMapData
} from '@/core/terrain/heightMapFormat'

/**
 * Разрешение диапазона высот: явные аргументы приоритизируются, отсутствующие берутся из данных.
 * Отслеживает явность каждой границы отдельно — скан данных заполняет ТОЛЬКО отсутствующую границу.
 */
export function resolveHeightRange(
  data: Float32Array,
  minMeters?: number,
  maxMeters?: number
): { minMeters: number; maxMeters: number } {
  // Если обе границы явно заданы, возвращаем как есть (данные не сканируются).
  if (minMeters !== undefined && maxMeters !== undefined) {
    return { minMeters, maxMeters }
  }

  // Сканируем данные, но только если нужна хотя бы одна граница.
  let dataMin = Infinity
  let dataMax = -Infinity

  for (const value of data) {
    if (value < dataMin) dataMin = value
    if (value > dataMax) dataMax = value
  }

  // Явно заданную границу НЕ трогаем; заполняем ТОЛЬКО отсутствующую.
  return {
    minMeters: minMeters ?? dataMin,
    maxMeters: maxMeters ?? dataMax
  }
}

/** Нормировка высот в Uint16: min→0, max→65535, значения вне диапазона клампятся. */
export function normalizeToUint16(data: Float32Array, minMeters: number, maxMeters: number): Uint16Array {
  const span = maxMeters - minMeters

  if (span <= 0) {
    throw new Error(`Диапазон высот пуст: min=${minMeters}, max=${maxMeters}`)
  }

  const out = new Uint16Array(data.length)

  for (let i = 0; i < data.length; i++) {
    const t = (data[i] - minMeters) / span
    out[i] = Math.round(Math.min(1, Math.max(0, t)) * 65535)
  }

  return out
}

/** Зеркало parseHeightMap — паритет закреплён round-trip тестом. */
export function encodeHeightMap(map: HeightMapData): Buffer {
  const buffer = Buffer.alloc(HEIGHT_MAP_HEADER_BYTES + map.data.length * 2)

  buffer.writeUInt32LE(HEIGHT_MAP_MAGIC, 0)
  buffer.writeUInt32LE(HEIGHT_MAP_VERSION, 4)
  buffer.writeUInt32LE(map.width, 8)
  buffer.writeUInt32LE(map.height, 12)
  buffer.writeFloatLE(map.minMeters, 16)
  buffer.writeFloatLE(map.maxMeters, 20)
  Buffer.from(map.data.buffer, map.data.byteOffset, map.data.byteLength).copy(buffer, HEIGHT_MAP_HEADER_BYTES)

  return buffer
}
