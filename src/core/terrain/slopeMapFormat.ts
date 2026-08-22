/**
 * Дефолт/фолбэк предела кодируемого уклона slope-карты (tan угла): ±2 ≈ 63°.
 * Реальный диапазон — per-map, из строки slope-ресурса (`slopeRange`,
 * значение сетки `SLOPE_RANGE_GRID`); эта константа — то, чем кодируются
 * карты БЕЗ объявленного `slopeRange`, и опорная точка сетки.
 *
 * Диапазон карты доходит до GLSL-декода юниформом `uSlopeRange`
 * (`chunks/SlopeNormal.ts`), а на CPU читается энкодером
 * (`scripts/lib/slopeMapEncode.ts`, `options.slopeRange`) — обе стороны
 * согласуются через строку ресурса, а не через эту константу. Кодировка
 * знаковая: байт 128 = 0, крайние 1/255 = ∓slopeRange — ноль представим
 * точно.
 *
 * Канал B — signed cavity рельефа (полость: яма/гребень), а не уклон — своя
 * шкала [−1, 1], не slopeRange. Decode: `(byte−128)/127` БЕЗ домножения на
 * диапазон. Энкодер (`scripts/lib/slopeMapEncode.ts`) домножает cavity на
 * диапазон карты перед общим квантователем — тот же квантователь делит на
 * него обратно (контракт квантователя для R/G), и без этого компенсирующего
 * умножения cavity ∈ [−1,1] квантовался бы только в 128±63.5, вдвое уже
 * фактического диапазона байта. Знак: положительное — гребень (светлее),
 * отрицательное — яма (темнее).
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
