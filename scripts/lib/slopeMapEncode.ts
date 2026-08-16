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
 *
 * Квантование с дизером: к дробной части МЗР перед округлением добавляется
 * детерминированный шум из хеша (x, y, канал) в [-0.5, 0.5). Уклоны положе
 * половины МЗР (мелкий рельеф на теле с крупным текселем) иначе квантуются в
 * константный байт на всей области - сигнал теряется целиком; дизер
 * рассеивает их по соседним байтам стохастически, среднее по площади (мип,
 * билинейка) сходится к истинной величине. Формат и декодер не меняются:
 * round(n + u), u из [-0.5, 0.5) - целые значения МЗР (честный ноль, кламп
 * диапазона) воспроизводятся точно, дизер трогает только дробный остаток.
 */

/** Раунд finalizer-миксера дизера: умножение на нечётную константу + ксор-сдвиг для лавинного перемешивания битов. */
function ditherMix32(value: number, constant: number): number {
  let h = Math.imul(value ^ (value >>> 15), constant)
  h ^= h >>> 13

  return h
}

/** Детерминированный хеш (x, y, канал) в [0, 1) - свой маленький миксер, не рантайм-хеши src/. */
function ditherHash01(x: number, y: number, channel: number): number {
  let h = ditherMix32(x | 0, 0x27d4eb2f)
  h = ditherMix32(h ^ (y | 0), 0x85ebca6b)
  h = ditherMix32(h ^ (channel | 0), 0xc2b2ae35)

  return (h >>> 0) / 0x100000000
}

export function buildSlopeMap(map: HeightMapData, radiusMeters: number): Uint8Array {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new Error(`Радиус тела невалиден: ${radiusMeters}`)
  }

  const { width, height, minMeters, maxMeters, data } = map
  const metersPerRaw = (maxMeters - minMeters) / 65535
  const northArc = (Math.PI * radiusMeters) / height
  const out = new Uint8Array(width * height * 3)

  const encode = (slope: number, x: number, y: number, channel: number): number => {
    const clamped = Math.max(-SLOPE_RANGE, Math.min(SLOPE_RANGE, slope))
    const value = (clamped / SLOPE_RANGE) * 127
    const dithered = value + (ditherHash01(x, y, channel) - 0.5)

    return Math.max(0, Math.min(255, Math.round(128 + dithered)))
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
      out[i] = encode(slopeEast, x, y, 0)
      out[i + 1] = encode(slopeNorth, x, y, 1)
    }
  }

  return out
}
