/**
 * Средние детальных текстур для нормировки слоя TerrainDetail: деталь должна
 * МОДУЛИРОВАТЬ альбедо вокруг 1, а не умножать его на среднюю яркость файла —
 * иначе тело темнеет по мере вхождения детали (fade по дистанции камеры):
 * rocky_trail_diff в линейном свете в среднем 0.23, AO 0.63 → ×0.19 вблизи.
 *
 * meanLum — средняя яркость diff в ЛИНЕЙНОМ свете (файлы sRGB, шейдер видит
 * декод); meanAo — средний R канала ARM (линейный, без colorSpace). Считано
 * по файлам storage (ресайз 512², люма 0.2126/0.7152/0.0722) — страж
 * tests/terrain/detailTextureStats.spec.ts пересчитывает при наличии файлов.
 * Неизвестный путь — 1 (нормировки нет, поведение как раньше).
 */
export interface DetailTextureStats {
  meanLum: number
  meanAo: number
}

export const DETAIL_TEXTURE_STATS: Readonly<Record<string, Readonly<Partial<DetailTextureStats>>>> = {
  'terrain/rocky_trail_diff.webp': { meanLum: 0.233 },
  'terrain/rocky_trail_arm.webp': { meanAo: 0.628 },
  'terrain/ice_diff.webp': { meanLum: 0.27 },
  'terrain/ice_arm.webp': { meanAo: 0.942 },
  'terrain/sand_diff.webp': { meanLum: 0.342 },
  'terrain/sand_arm.webp': { meanAo: 0.882 },
  'terrain/volcanic_diff.webp': { meanLum: 0.091 },
  'terrain/volcanic_arm.webp': { meanAo: 0.928 }
}

/** Множители нормировки набора: x = 1/meanLum диффуза, y = 1/meanAo ARM; неизвестный путь → 1. */
export function detailTintNorm(diffPath: unknown, armPath: unknown): { x: number; y: number } {
  const lum = typeof diffPath === 'string' ? DETAIL_TEXTURE_STATS[diffPath]?.meanLum : undefined
  const ao = typeof armPath === 'string' ? DETAIL_TEXTURE_STATS[armPath]?.meanAo : undefined

  return { x: lum && lum > 0 ? 1 / lum : 1, y: ao && ao > 0 ? 1 / ao : 1 }
}
