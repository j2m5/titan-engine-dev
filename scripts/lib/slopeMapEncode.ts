import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'

export { SLOPE_RANGE }

/**
 * Slope-карта из карты высот: на каждый тексель — безразмерный уклон
 * поверхности (Δh на метр дуги) центральной разностью. R — уклон на восток,
 * G — на север (строка 0 = север, как в TEHM), B — ноль. Кодировка знаковая:
 * байт 128 = 0, 1..255 = −SLOPE_RANGE..+SLOPE_RANGE — ноль представим точно.
 *
 * Арки честные: восточная дуга делится на cos широты. Широта строки — по
 * полутексельной конвенции GPU (центр текселя на y+0.5): потребитель —
 * texture2D, и заодно cos никогда не обнуляется на полюсах. Долгота
 * заворачивается (шов меридиана), широта клампится (полярные строки).
 */
export function buildSlopeMap(map: HeightMapData, radiusMeters: number): Uint8Array {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new Error(`Радиус тела невалиден: ${radiusMeters}`)
  }

  const { width, height, minMeters, maxMeters, data } = map
  const metersPerRaw = (maxMeters - minMeters) / 65535
  const northArc = (Math.PI * radiusMeters) / height
  const out = new Uint8Array(width * height * 3)

  const encode = (slope: number): number => {
    const clamped = Math.max(-SLOPE_RANGE, Math.min(SLOPE_RANGE, slope))

    return Math.round(128 + (clamped / SLOPE_RANGE) * 127)
  }

  for (let y = 0; y < height; y++) {
    const latitude = Math.PI / 2 - ((y + 0.5) / height) * Math.PI
    const eastArc = (2 * Math.PI * radiusMeters * Math.cos(latitude)) / width
    const yNorth = Math.max(y - 1, 0)
    const ySouth = Math.min(y + 1, height - 1)
    // полярные строки клампят соседа: разность односторонняя, пролёт короче
    const northSpanArc = (ySouth - yNorth) * northArc
    const row = y * width

    // База восточной разности расширяется до метрической длины пары
    // экваториальных текселей: сжатые cos-широтой дуги у полюсов иначе
    // усиливают 16-битное квантование высот в сатурированный шум уклона
    // (0.3 м шага квантования на дугу 0.5 м — уже уклон 0.6). Кламп width/4 —
    // защита от вырождения разности на всю окружность у самого полюса.
    const eastSpan = Math.max(1, Math.min(Math.floor(width / 4), Math.round(1 / Math.cos(latitude))))

    for (let x = 0; x < width; x++) {
      const west = row + ((x - eastSpan + width) % width)
      const east = row + ((x + eastSpan) % width)

      const slopeEast = ((data[east] - data[west]) * metersPerRaw) / (2 * eastSpan * eastArc)
      // карта в одну строку вырождает пролёт в ноль — уклона к северу нет
      const slopeNorth =
        northSpanArc === 0 ? 0 : ((data[yNorth * width + x] - data[ySouth * width + x]) * metersPerRaw) / northSpanArc

      const i = (row + x) * 3
      out[i] = encode(slopeEast)
      out[i + 1] = encode(slopeNorth)
    }
  }

  return out
}
