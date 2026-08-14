import type { HeightMapData } from '@/core/terrain/heightMapFormat'

/**
 * Предел кодируемого уклона (tan угла): ±2 ≈ 63°. Реальные склоны Луны и
 * скалистых тел положе; всё круче — артефакт данных, клампится.
 */
export const SLOPE_RANGE = 2

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
    const rowNorth = Math.max(y - 1, 0) * width
    const rowSouth = Math.min(y + 1, height - 1) * width
    const row = y * width

    for (let x = 0; x < width; x++) {
      const west = row + ((x - 1 + width) % width)
      const east = row + ((x + 1) % width)

      const slopeEast = ((data[east] - data[west]) * metersPerRaw) / (2 * eastArc)
      const slopeNorth = ((data[rowNorth + x] - data[rowSouth + x]) * metersPerRaw) / (2 * northArc)

      const i = (row + x) * 3
      out[i] = encode(slopeEast)
      out[i + 1] = encode(slopeNorth)
    }
  }

  return out
}
