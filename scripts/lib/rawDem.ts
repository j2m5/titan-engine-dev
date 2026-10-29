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
 * Даунсемпл DEM усреднением по площади пересечения исходных и целевых ячеек.
 * Дробный коэффициент сохраняет среднее растра: крайние ячейки учитываются
 * лишь своей долей, а не как целые. Положительные веса не создают звона или
 * выбросов за диапазон исходных высот.
 *
 * Здесь площадь в координатах растра (pixel-is-area, исходная ячейка 1×1),
 * не площадь на сфере; геопривязку источника функция не преобразует.
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
    const yStart = dy * yRatio
    const yEnd = Math.min((dy + 1) * yRatio, srcHeight)
    const y0 = Math.floor(yStart)
    const y1 = Math.ceil(yEnd)

    for (let dx = 0; dx < dstWidth; dx++) {
      const xStart = dx * xRatio
      const xEnd = Math.min((dx + 1) * xRatio, srcWidth)
      const x0 = Math.floor(xStart)
      const x1 = Math.ceil(xEnd)

      let sum = 0

      for (let y = y0; y < y1; y++) {
        const yWeight = Math.min(y + 1, yEnd) - Math.max(y, yStart)
        let rowSum = 0

        for (let x = x0; x < x1; x++) {
          const xWeight = Math.min(x + 1, xEnd) - Math.max(x, xStart)
          rowSum += data[y * srcWidth + x] * xWeight
        }

        sum += rowSum * yWeight
      }

      out[dy * dstWidth + dx] = sum / ((xEnd - xStart) * (yEnd - yStart))
    }
  }

  return out
}
