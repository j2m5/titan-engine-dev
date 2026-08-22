/**
 * Предел кодируемого уклона slope-карты (tan угла): ±SLOPE_RANGE ≈ 63°.
 * Реальные склоны Луны и скалистых тел положе; всё круче — артефакт данных,
 * энкодер клампит.
 *
 * Константа общая для энкодера (scripts/lib/slopeMapEncode.ts) и GLSL-декода
 * (chunks/SlopeNormal.ts, интерполяция в шаблонную строку): перекалибровка
 * диапазона в одном месте согласованно меняет обе стороны. Кодировка знаковая:
 * байт 128 = 0, крайние 1/255 = ∓SLOPE_RANGE — ноль представим точно.
 *
 * Канал B — signed cavity рельефа (полость: яма/гребень), а не уклон — своя
 * шкала, не SLOPE_RANGE. Кодировка байта та же (128 = 0), но decode другой:
 * `(byte−128)/127` БЕЗ домножения на SLOPE_RANGE, диапазон канала — весь
 * [−1, 1] на ±127 байт. Энкодер (`scripts/lib/slopeMapEncode.ts`) перед
 * общим квантователем `encode` домножает cavity на SLOPE_RANGE — тот же
 * квантователь делит на SLOPE_RANGE обратно (контракт для R/G), и без этого
 * компенсирующего умножения cavity ∈ [−1,1] квантовался бы только в
 * 128±63.5, вдвое уже фактического диапазона байта. Знак: положительное —
 * гребень (светлее), отрицательное — яма (темнее).
 */
export const SLOPE_RANGE = 2

/**
 * Допустимые per-map пределы (строка slope-ресурса `slopeRange`): сетка
 * степеней двойки, чтобы значения не плавали при пересборке. Отсутствие
 * поля = SLOPE_RANGE.
 */
export const SLOPE_RANGE_GRID: readonly number[] = [0.25, 0.5, 1, 2, 4]

/** Наименьшее значение сетки ≥ p99.9 модуля уклона карты; выше потолка — потолок (выбросы клампятся). */
export function recommendSlopeRange(p999: number): number {
  return SLOPE_RANGE_GRID.find((v) => v >= p999) ?? SLOPE_RANGE_GRID[SLOPE_RANGE_GRID.length - 1]
}

export function isValidSlopeRange(value: unknown): value is number {
  return typeof value === 'number' && SLOPE_RANGE_GRID.includes(value)
}
