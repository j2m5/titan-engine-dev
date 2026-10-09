import { describe, it, expect } from 'vitest'
import {
  GAIA_FACES,
  GaiaLevelTracker,
  gaiaTileByteLength,
  gaiaTiles,
  planGaiaUploads,
  splitGaiaTile,
  type GaiaTile
} from '@/core/sky/gaiaTiles'

const tiles = gaiaTiles()
const byLevel = (level: number): GaiaTile[] => tiles.filter((tile) => tile.level === level)

describe('gaiaTiles: список тайлов в порядке загрузки', () => {
  it('516 тайлов: уровни 4, 3, 2, 1, 0 — по 6, 6, 24, 96, 384', () => {
    expect(tiles).toHaveLength(516)
    expect([4, 3, 2, 1, 0].map((level) => byLevel(level).length)).toEqual([6, 6, 24, 96, 384])
    expect(tiles.map((tile) => tile.level)).toEqual([...tiles.map((tile) => tile.level)].sort((a, b) => b - a))
  })

  it('имена как у загрузчика Брунетона; порядок граней = POSITIVE_X + индекс', () => {
    expect(GAIA_FACES).toEqual(['pos-x', 'neg-x', 'pos-y', 'neg-y', 'pos-z', 'neg-z'])
    expect(tiles[0].name).toBe('pos-x-4-0-0')
    expect(byLevel(0).find((tile) => tile.face === 5 && tile.i === 7 && tile.j === 3)!.name).toBe('neg-z-0-7-3')
  })

  it('длина файла: уровень 0 — 524288 байт, хвост уровня 4 (уровни 4…11) — 174760', () => {
    expect(gaiaTileByteLength({ level: 0 })).toBe(524288)
    expect(gaiaTileByteLength({ level: 3 })).toBe(524288)
    expect(gaiaTileByteLength({ level: 4 })).toBe(174760)
  })
})

describe('splitGaiaTile: уровни файла', () => {
  it('уровень 0 — один уровень 256²: галактика, затем звёзды', () => {
    const data = new Uint32Array(2 * 256 * 256).map((_, i) => i)
    const [level] = splitGaiaTile(0, data)
    expect(level.level).toBe(0)
    expect(level.size).toBe(256)
    expect(level.galaxy[0]).toBe(0)
    expect(level.stars[0]).toBe(256 * 256)
  })

  it('уровень 4 — хвост 4…11, размеры 128 → 1', () => {
    const levels = splitGaiaTile(4, new Uint32Array(174760 / 4))
    expect(levels.map((l) => l.level)).toEqual([4, 5, 6, 7, 8, 9, 10, 11])
    expect(levels.map((l) => l.size)).toEqual([128, 64, 32, 16, 8, 4, 2, 1])
  })

  it('длина не сходится — ошибка, а не мусор в текстуре', () => {
    expect(() => splitGaiaTile(0, new Uint32Array(100))).toThrow()
  })
})

describe('planGaiaUploads: куда идут уровни', () => {
  it('уровень 0, тайл (3, 5): смещение 768, 1280; галактика и звёзды на уровень 0', () => {
    const tile = byLevel(0).find((t) => t.face === 2 && t.i === 3 && t.j === 5)!
    const uploads = planGaiaUploads(tile, new Uint32Array(2 * 256 * 256))
    expect(uploads.map((u) => [u.texture, u.face, u.level, u.x, u.y, u.size])).toEqual([
      ['galaxy', 2, 0, 768, 1280, 256],
      ['stars', 2, 0, 768, 1280, 256]
    ])
  })

  it('хвост: звёзды 4…6 — в «звёзды», 7…11 — в «грубые» на уровни 0…4', () => {
    const uploads = planGaiaUploads(byLevel(4)[0], new Uint32Array(174760 / 4))
    const stars = uploads.filter((u) => u.texture !== 'galaxy').map((u) => [u.texture, u.level])
    expect(stars).toEqual([
      ['stars', 4],
      ['stars', 5],
      ['stars', 6],
      ['starsCoarse', 0],
      ['starsCoarse', 1],
      ['starsCoarse', 2],
      ['starsCoarse', 3],
      ['starsCoarse', 4]
    ])
    expect(uploads.filter((u) => u.texture === 'galaxy').map((u) => u.level)).toEqual([4, 5, 6, 7, 8, 9, 10, 11])
  })
})

describe('GaiaLevelTracker: полный уровень', () => {
  it('ничего — Infinity; хвост на всех гранях — 4 (уровни 5…11 с ним)', () => {
    const tracker = new GaiaLevelTracker()
    expect(tracker.completeLevel()).toBe(Infinity)
    byLevel(4).slice(0, 5).forEach((tile) => tracker.markLoaded(tile))
    expect(tracker.completeLevel()).toBe(Infinity)
    tracker.markLoaded(byLevel(4)[5])
    expect(tracker.completeLevel()).toBe(4)
  })

  it('уровень полон только целиком; повтор тайла не считается дважды', () => {
    const tracker = new GaiaLevelTracker()
    byLevel(4).forEach((tile) => tracker.markLoaded(tile))
    byLevel(3).slice(0, 5).forEach((tile) => tracker.markLoaded(tile))
    tracker.markLoaded(byLevel(3)[0])
    expect(tracker.completeLevel()).toBe(4)
    tracker.markLoaded(byLevel(3)[5])
    expect(tracker.completeLevel()).toBe(3)
  })

  it('тонкий уровень без грубого не засчитывается', () => {
    const tracker = new GaiaLevelTracker()
    byLevel(3).forEach((tile) => tracker.markLoaded(tile))
    expect(tracker.completeLevel()).toBe(Infinity)
  })
})
