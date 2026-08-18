import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { bandPassSpherical } from './sphericalBandFilter'

/**
 * Полость рельефа (signed cavity) для запекания в канал B slope-карты:
 * гребень (выше окружения) — положительное значение, яма (ниже окружения) —
 * отрицательное. Из космоса читается как мягкий ambient occlusion без
 * дополнительного освещения (см. план арки, шапка).
 *
 * Пять октавных DoG-полос через `bandPassSpherical` (общее ядро,
 * scripts/lib/sphericalBandFilter.ts): σ_high/σ_low в текселях экватора
 * (1,2), (2,4), (4,8), (8,16), (16,32) — каждая октава вдвое шире предыдущей,
 * покрывает от мелкой ряби до тел-масштабных структур. Каждая полоса
 * нормируется СВОИМ 99-м процентилем |значение| (устойчиво к единичным
 * выбросам, тот же приём, что в synthHeightMap.ts), веса полос равные (1/5).
 * Сумма нормируется финальным p99(|·|) и клампится в [−1, 1] — по построению
 * почти всегда внутри диапазона, кламп только страхует от редких экстремумов.
 *
 * Знак DoG (узкое минус широкое) для изолированной ямы даёт классический
 * профиль «мексиканской шляпы»: центр ямы глубже (уже-блюр держит форму,
 * шире-блюр её размывает к нулю → разница отрицательна), вал вокруг —
 * компенсирующий положительный обод (энергия полосы в среднем нулевая).
 * Для гребня — зеркально, положительный центр.
 */

const BAND_SIGMAS: ReadonlyArray<readonly [sigmaHighTexels: number, sigmaLowTexels: number]> = [
  [1, 2],
  [2, 4],
  [4, 8],
  [8, 16],
  [16, 32],
]

const BAND_WEIGHT = 1 / BAND_SIGMAS.length

/** 99-й процентиль |values| (не мутирует вход) — устойчивая нормировка, выброс не сжимает типичный сигнал. */
function percentile99Abs(values: Float64Array): number {
  const abs = Float64Array.from(values, (v) => Math.abs(v))
  abs.sort()
  const idx = Math.floor(0.99 * (abs.length - 1))

  return abs[idx]
}

/**
 * Разворачивает Uint16-поле высот TEHM в float-метры: honest unpack,
 * хотя дальнейшая p99-нормировка полос делает результат инвариантным к
 * аффинному преобразованию входа (сдвиг гасится разностью блюров DoG,
 * масштаб — делением на p99 той же полосы) — сырой Uint16 без разворота
 * дал бы численно тот же cavity-профиль. Разворачиваем всё равно: вход
 * должен быть тем, чем он называется (метры), а не сырыми кодами формата.
 */
function unpackHeightMeters(map: HeightMapData): Float64Array {
  const { width, height, minMeters, maxMeters, data } = map
  const range = maxMeters - minMeters
  const field = new Float64Array(width * height)

  for (let i = 0; i < field.length; i++) field[i] = minMeters + (data[i] / 65535) * range

  return field
}

/**
 * Signed cavity в [−1, 1], длина width·height (см. докблок модуля).
 * Плоское поле (все полосы p99=0) даёт честный ноль на всей карте.
 */
export function buildCavityField(map: HeightMapData): Float64Array {
  const { width, height } = map
  const field = unpackHeightMeters(map)
  const sum = new Float64Array(width * height)

  for (const [sigmaHighTexels, sigmaLowTexels] of BAND_SIGMAS) {
    const band = bandPassSpherical(field, width, height, sigmaLowTexels, sigmaHighTexels)
    const p99 = percentile99Abs(band)
    if (p99 === 0) continue // полоса нулевая (например, идеально плоское поле) — пропуск, а не деление на ноль

    for (let i = 0; i < sum.length; i++) sum[i] += (band[i] / p99) * BAND_WEIGHT
  }

  const finalP99 = percentile99Abs(sum)
  const out = new Float64Array(width * height)
  if (finalP99 === 0) return out // все полосы пусты — рельефа нет, полость честно нулевая

  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, sum[i] / finalP99))

  return out
}
