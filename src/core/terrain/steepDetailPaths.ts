/**
 * Универсальный «крутой» набор зон материала: на крутых склонах ЛЮБОГО
 * терраформного тела проступает скальная порода cliff_side. Грунтовые наборы
 * (включая rocky_trail Луны) остаются самостоятельными материалами.
 * Источник CC0 и рецепт: docs/terrain-quality-2026-11-12.md.
 * Единственный источник этих строк — материал и стример импортируют отсюда
 * (дублирование строк путей запрещено: тесты данных дискриминируют пути).
 * Смена на пер-тельный «steep-пивот» = замена констант на выборку из ресурсов.
 */
export const STEEP_DETAIL_PATHS = {
  diffuse: 'terrain/cliff_side_diff.webp',
  normal: 'terrain/cliff_side_nor.webp',
  arm: 'terrain/cliff_side_arm.webp'
} as const

/** Loose fragments reuse the existing rocky ground assets on the fine detail domain. */
export const TALUS_DETAIL_PATHS = {
  diffuse: 'terrain/rocky_trail_diff.webp',
  normal: 'terrain/rocky_trail_nor.webp'
} as const
