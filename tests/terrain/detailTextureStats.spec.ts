import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { DETAIL_TEXTURE_STATS, detailTintNorm } from '@/core/terrain/detailTextureStats'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'

const STORAGE = 'storage/images/textures/'
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

describe('detailTextureStats: нормировка детального слоя', () => {
  it('множители — обратные средним; неизвестный путь и не-строка → 1', () => {
    const rocky = detailTintNorm(STEEP_DETAIL_PATHS.diffuse, STEEP_DETAIL_PATHS.arm)
    expect(rocky.x).toBeCloseTo(1 / 0.233, 9)
    expect(rocky.y).toBeCloseTo(1 / 0.628, 9)
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
  // допуск 0.015 — ресайз 512² area-average против исходника
  const entries = Object.entries(DETAIL_TEXTURE_STATS).filter(([path]) => existsSync(STORAGE + path))
  it.skipIf(entries.length === 0)('константы совпадают с файлами storage (ресайз 512², линейная люма / R канал)', async () => {
    for (const [path, stats] of entries) {
      const { data, info } = await sharp(STORAGE + path).resize(512, 512).raw().toBuffer({ resolveWithObject: true })
      const n = info.width * info.height
      let lum = 0
      let r = 0
      for (let i = 0; i < n; i++) {
        const p = i * info.channels
        r += data[p] / 255
        lum += 0.2126 * toLinear(data[p] / 255) + 0.7152 * toLinear(data[p + 1] / 255) + 0.0722 * toLinear(data[p + 2] / 255)
      }
      if (stats.meanLum !== undefined) expect(Math.abs(lum / n - stats.meanLum)).toBeLessThan(0.015)
      if (stats.meanAo !== undefined) expect(Math.abs(r / n - stats.meanAo)).toBeLessThan(0.015)
    }
  })
})
