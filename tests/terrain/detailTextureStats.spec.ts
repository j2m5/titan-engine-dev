import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DETAIL_TEXTURE_STATS, detailTintNorm } from '@/core/terrain/detailTextureStats'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'
import { measureDetailStats } from '../../scripts/lib/detailTextureStats'

const STORAGE = 'storage/images/textures/'

describe('detailTextureStats: нормировка детального слоя', () => {
  it('множители — обратные средним; неизвестный путь и не-строка → 1', () => {
    const rocky = detailTintNorm(STEEP_DETAIL_PATHS.diffuse, STEEP_DETAIL_PATHS.arm)
    expect(rocky.x).toBeCloseTo(1 / DETAIL_TEXTURE_STATS[STEEP_DETAIL_PATHS.diffuse]!.meanLum!, 9)
    expect(rocky.y).toBeCloseTo(1 / DETAIL_TEXTURE_STATS[STEEP_DETAIL_PATHS.arm]!.meanAo!, 9)
    expect(detailTintNorm('terrain/nope_diff.webp', undefined)).toEqual({ x: 1, y: 1 })
    expect(detailTintNorm(undefined, 42)).toEqual({ x: 1, y: 1 })
  })

  it('у каждого архетипа пара diff (meanLum) + arm (meanAo), steep-набор покрыт', () => {
    for (const set of ['rocky_trail', 'ice', 'sand', 'volcanic']) {
      expect(DETAIL_TEXTURE_STATS[`terrain/${set}_diff.webp`]?.meanLum).toBeGreaterThan(0)
      expect(DETAIL_TEXTURE_STATS[`terrain/${set}_arm.webp`]?.meanAo).toBeGreaterThan(0)
    }
    expect(DETAIL_TEXTURE_STATS[STEEP_DETAIL_PATHS.diffuse]).toBeDefined()
    expect(DETAIL_TEXTURE_STATS[STEEP_DETAIL_PATHS.arm]).toBeDefined()
  })

  // Страж констант по реальным файлам (вне git): пересчёт тем же рецептом,
  // что и storage/пересчёт (scripts/lib/detailTextureStats) — единый источник
  const entries = Object.entries(DETAIL_TEXTURE_STATS).filter(([path]) => existsSync(STORAGE + path))
  it.skipIf(entries.length === 0)('константы совпадают с файлами storage по рецепту scripts/lib/detailTextureStats', async () => {
    for (const [path, stats] of entries) {
      const measured = await measureDetailStats(STORAGE + path)
      if (stats.meanLum !== undefined) expect(Math.abs(measured.meanLum - stats.meanLum)).toBeLessThan(0.002)
      if (stats.meanAo !== undefined) expect(Math.abs(measured.meanAo - stats.meanAo)).toBeLessThan(0.002)
    }
  })
})
