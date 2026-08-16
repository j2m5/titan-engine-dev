import { Buffer } from 'node:buffer'

/**
 * Чтение сырого int16 растра — формат PDS IMG, в котором LOLA/MOLA раздают
 * даунсемплы DEM (глобальный GeoTIFF есть только у полного разрешения и весит
 * гигабайты). Заголовка у файла нет: размеры, масштаб и порядок байт приходят
 * из отдельного .LBL и передаются флагами.
 *
 * `scaleMeters` — множитель значения в метры (LDEM хранит единицы 0.5 м
 * относительно референсной сферы 1737.4 км: метры = значение × 0.5).
 *
 * `bigEndian` — порядок байт значения: LOLA (Луна) раздаёт LSB_INTEGER
 * (little-endian, дефолт), MOLA (Марс, PDS MEGDR) — MSB_INTEGER (big-endian).
 * Спутано с LE в наблюдаемом наборе — не датум/масштаб, а `.LBL` DATA_TYPE
 * поле: значение min/max ушло к границам int16 (-32768/32767) вместо
 * физического диапазона, если продукт на самом деле MSB, а флаг не передан.
 */
export function readRawInt16Dem(
  buffer: Buffer,
  width: number,
  height: number,
  scaleMeters: number,
  bigEndian: boolean = false
): Float32Array {
  const expectedBytes = width * height * 2

  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Сырой DEM: размер файла не сходится (ожидалось ${expectedBytes} байт, получено ${buffer.byteLength})`)
  }

  // Int16Array-вью требует чётного byteOffset — Buffer из readFile его не
  // гарантирует, поэтому через DataView с явным порядком байт
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const out = new Float32Array(width * height)
  const littleEndian = !bigEndian

  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, littleEndian) * scaleMeters
  }

  return out
}

/**
 * Даунсемпл DEM усреднением по площади: каждый целевой пиксель — среднее всех
 * исходных, чьи центры попадают в его футпринт. Для карт высот это корректнее
 * lanczos: точечные данные без звона и выбросов на кромках кратеров, а
 * апсемпла в нашем конвейере не бывает (исходники всегда плотнее целевых
 * 8192×4096).
 */
export function resampleDemGrid(
  data: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Float32Array {
  if (srcWidth === dstWidth && srcHeight === dstHeight) return data.slice()

  const out = new Float32Array(dstWidth * dstHeight)
  const xRatio = srcWidth / dstWidth
  const yRatio = srcHeight / dstHeight

  for (let dy = 0; dy < dstHeight; dy++) {
    const y0 = Math.floor(dy * yRatio)
    const y1 = Math.min(Math.max(Math.ceil((dy + 1) * yRatio), y0 + 1), srcHeight)

    for (let dx = 0; dx < dstWidth; dx++) {
      const x0 = Math.floor(dx * xRatio)
      const x1 = Math.min(Math.max(Math.ceil((dx + 1) * xRatio), x0 + 1), srcWidth)

      let sum = 0

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += data[y * srcWidth + x]
        }
      }

      out[dy * dstWidth + dx] = sum / ((x1 - x0) * (y1 - y0))
    }
  }

  return out
}
