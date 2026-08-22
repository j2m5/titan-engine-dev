import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { isValidSlopeRange, SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'
import { WATER_SHALLOW_RANGE_METERS } from '@/core/terrain/waterLevel'
import { buildCavityField } from './cavityMap'

export { SLOPE_RANGE }

/**
 * Slope-карта из карты высот: на каждый тексель — безразмерный уклон
 * поверхности (Δh на метр дуги) центральной разностью. R — уклон на восток,
 * G — на север (строка 0 = север, как в TEHM), B — signed cavity рельефа
 * (гребень светлее, яма темнее — см. cavityMap.ts), опционально нулевая.
 * Кодировка знаковая: байт 128 = 0, 1..255 = −slopeRange..+slopeRange —
 * ноль представим точно. Диапазон — параметр конкретной карты (`options.slopeRange`,
 * значение из `SLOPE_RANGE_GRID`), дефолт `SLOPE_RANGE`.
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
 *
 * Канал B переиспользует ТОТ ЖЕ квантователь `encode`, что и R/G, поэтому
 * значение cavity ∈ [−1, 1] домножается на slopeRange перед вызовом — сам
 * `encode` делит на slopeRange обратно (это его контракт для уклонов), и
 * без компенсирующего умножения cavity=±1 квантовался бы только в байты
 * 128±63.5 при slopeRange=2 (диапазон уклонов вдвое шире диапазона cavity).
 * С умножением cavity=−1 → байт 1, cavity=+1 → байт 255 при ЛЮБОМ slopeRange —
 * та же точность и тот же дизер (хеш с channel=2), что и у R/G. Потребитель
 * канала B декодирует его БЕЗ повторного умножения на slopeRange:
 * (byte−128)/127 сразу даёт cavity.
 *
 * Канал A (опционально, `options.waterLevelMeters` задан) — запечённая
 * глубина воды: `clamp((уровень − h) / range, 0, 1)` → байт 0..255 без знака
 * (0 = суша/урез, 255 = глубже `shallowRangeMeters`, дефолт `WATER_SHALLOW_RANGE_METERS`
 * = 200 м — общая константа с SSE-потолком подводных патчей суши, см. её
 * докблок в `src/core/terrain/waterLevel.ts`). БЕЗ
 * дизера — в отличие от R/G/B глубина воды гладкая монотонная величина без
 * мелкого рельефа, который дизер существует спасать; квант 8 бит на 200 м —
 * 0.8 м на байт, ступеньки ниже порога восприятия воды и не нуждаются в
 * рассеивании шумом. Выход становится 4-канальным RGBA только когда
 * `waterLevelMeters` задан — тела без воды остаются 3-канальными RGB
 * байт-в-байт (44 карты арки cavity не пересобираются). Загрузчик текстур
 * расширяет 3-канальные текстуры до RGBA на GPU (opaque, A=255) — это
 * безвредно: шейдер читает канал A только под `USE_WATER_DEPTH`, а этот
 * дефайн ставится только телам с водой, у которых карта и так 4-канальная.
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

/**
 * Общая геометрия обхода slope-карты: центральные разности высот в честных
 * метрических уклонах (арки, полутексельная широта, шов долготы, полярный
 * кламп пролёта — см. докблок модуля). Вызывает `visit` на каждый тексель,
 * без квантования в байты — используется энкодером и статистикой (Task 3).
 */
export function forEachSlope(
  map: HeightMapData,
  radiusMeters: number,
  visit: (x: number, y: number, slopeEast: number, slopeNorth: number) => void
): void {
  const { width, height, minMeters, maxMeters, data } = map
  const metersPerRaw = (maxMeters - minMeters) / 65535
  const northArc = (Math.PI * radiusMeters) / height

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

      visit(x, y, slopeEast, slopeNorth)
    }
  }
}

/** Доля текселей, чей уклон по любой оси выходит за slopeRange (клампится энкодером). */
export function countClampedTexels(
  map: HeightMapData,
  radiusMeters: number,
  slopeRange: number
): { clamped: number; total: number } {
  let clamped = 0
  forEachSlope(map, radiusMeters, (_x, _y, e, n) => {
    if (Math.abs(e) > slopeRange || Math.abs(n) > slopeRange) clamped++
  })
  return { clamped, total: map.width * map.height }
}

export function buildSlopeMap(
  map: HeightMapData,
  radiusMeters: number,
  options?: { cavity?: boolean; waterLevelMeters?: number; shallowRangeMeters?: number; slopeRange?: number }
): Uint8Array {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new Error(`Радиус тела невалиден: ${radiusMeters}`)
  }

  const slopeRange = options?.slopeRange ?? SLOPE_RANGE
  if (!isValidSlopeRange(slopeRange)) {
    throw new Error(`slopeRange вне сетки: ${slopeRange}`)
  }

  const { width, height, minMeters, maxMeters, data } = map
  const metersPerRaw = (maxMeters - minMeters) / 65535
  // канал A (вода) только когда явно задан уровень — иначе выход 3-канальный
  // байт-в-байт как до этой правки (44 карты арки cavity не пересобираются)
  const waterLevelMeters = options?.waterLevelMeters
  const hasWater = waterLevelMeters !== undefined
  const shallowRangeMeters = options?.shallowRangeMeters ?? WATER_SHALLOW_RANGE_METERS

  if (hasWater && (!Number.isFinite(shallowRangeMeters) || shallowRangeMeters <= 0)) {
    throw new Error(`shallowRangeMeters (диапазон обмеления) невалиден: ${shallowRangeMeters}`)
  }

  const channels = hasWater ? 4 : 3
  const out = new Uint8Array(width * height * channels)
  // дефолт true (арка cavity); { cavity: false } — паритетный режим, канал B
  // остаётся нулевым (Uint8Array уже заполнен нулями) байт-в-байт как раньше
  const cavityField = (options?.cavity ?? true) ? buildCavityField(map) : null

  const encode = (slope: number, x: number, y: number, channel: number): number => {
    const clamped = Math.max(-slopeRange, Math.min(slopeRange, slope))
    const value = (clamped / slopeRange) * 127
    const dithered = value + (ditherHash01(x, y, channel) - 0.5)

    return Math.max(0, Math.min(255, Math.round(128 + dithered)))
  }

  forEachSlope(map, radiusMeters, (x, y, slopeEast, slopeNorth) => {
    const row = y * width
    const i = (row + x) * channels
    out[i] = encode(slopeEast, x, y, 0)
    out[i + 1] = encode(slopeNorth, x, y, 1)
    if (cavityField) out[i + 2] = encode(cavityField[row + x] * slopeRange, x, y, 2)
    if (hasWater) {
      const hMeters = minMeters + data[row + x] * metersPerRaw
      const depthFraction = Math.max(0, Math.min(1, (waterLevelMeters! - hMeters) / shallowRangeMeters))
      out[i + 3] = Math.round(depthFraction * 255)
    }
  })

  return out
}
