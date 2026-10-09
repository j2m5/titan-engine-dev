import { describe, it, expect } from 'vitest'
import { gaiaTileByteLength, gaiaTiles, type GaiaTile } from '@/core/sky/gaiaTiles'
import { loadGaiaTiles } from '@/core/sky/gaiaTileLoader'

// Хвосты уровня 4: шесть файлов по 174760 байт — дёшево для тестов
const tails: GaiaTile[] = gaiaTiles().filter((tile) => tile.level === 4)
const ok = (tile: GaiaTile): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(gaiaTileByteLength(tile)))

describe('loadGaiaTiles', () => {
  it('грузит все; onTile получает Uint32Array полной длины, первым — первый тайл списка', async () => {
    const seen: Array<[string, number]> = []
    const result = await loadGaiaTiles(tails, ok, (tile, data) => seen.push([tile.name, data.length]))

    expect(result).toEqual({ loaded: 6, failed: [], aborted: false })
    expect(seen[0]).toEqual(['pos-x-4-0-0', 174760 / 4])
    expect(seen).toHaveLength(6)
  })

  it('первый тайл недоступен — тайлов нет вовсе: остальные не запрашиваются', async () => {
    const requested: string[] = []
    const result = await loadGaiaTiles(
      tails,
      (tile) => {
        requested.push(tile.name)
        return Promise.reject(new Error('404'))
      },
      () => {}
    )

    expect(result.aborted).toBe(true)
    expect(result.loaded).toBe(0)
    expect(result.failed).toHaveLength(6)
    expect(new Set(requested)).toEqual(new Set(['pos-x-4-0-0']))
  })

  it('неверная длина (HTML-заглушка dev-сервера со статусом 200) — отказ после повторов', async () => {
    const attempts = new Map<string, number>()
    const result = await loadGaiaTiles(
      tails,
      (tile) => {
        attempts.set(tile.name, (attempts.get(tile.name) ?? 0) + 1)
        return tile.face === 3 ? Promise.resolve(new ArrayBuffer(512)) : ok(tile)
      },
      () => {},
      6,
      2
    )

    expect(result.failed.map((tile) => tile.name)).toEqual(['neg-y-4-0-0'])
    expect(attempts.get('neg-y-4-0-0')).toBe(3)
    expect(result.loaded).toBe(5)
  })

  it('временный сбой лечится повтором', async () => {
    let first = true
    const result = await loadGaiaTiles(
      tails,
      (tile) => {
        if (tile.face === 1 && first) {
          first = false
          return Promise.reject(new Error('сеть'))
        }
        return ok(tile)
      },
      () => {}
    )

    expect(result).toEqual({ loaded: 6, failed: [], aborted: false })
  })

  it('не больше concurrency запросов одновременно', async () => {
    let active = 0
    let peak = 0
    const slow = async (tile: GaiaTile): Promise<ArrayBuffer> => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return new ArrayBuffer(gaiaTileByteLength(tile))
    }
    await loadGaiaTiles(tails, slow, () => {}, 2)

    expect(peak).toBe(2)
  })
})
