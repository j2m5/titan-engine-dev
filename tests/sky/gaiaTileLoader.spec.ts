import { describe, it, expect, vi } from 'vitest'
import { gaiaTileByteLength, gaiaTiles, type GaiaTile } from '@/core/sky/gaiaTiles'
import { loadGaiaTiles } from '@/core/sky/gaiaTileLoader'

// Хвосты уровня 4: шесть файлов по 174760 байт — дёшево для тестов
const tails: GaiaTile[] = gaiaTiles().filter((tile) => tile.level === 4)
const ok = (tile: GaiaTile): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(gaiaTileByteLength(tile)))

describe('loadGaiaTiles', () => {
  it('грузит все; onTile получает Uint32Array полной длины, первым — первый тайл списка', async () => {
    const seen: Array<[string, number]> = []
    const result = await loadGaiaTiles(tails, ok, (tile, data) => seen.push([tile.name, data.length]))

    expect(result).toEqual({ loaded: 6, failed: [], aborted: false, cancelled: false })
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
      { concurrency: 6, retries: 2 }
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

    expect(result).toEqual({ loaded: 6, failed: [], aborted: false, cancelled: false })
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
    await loadGaiaTiles(tails, slow, () => {}, { concurrency: 2 })

    expect(peak).toBe(2)
  })

  it('отменённая до запуска загрузка не запрашивает тайлы', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchTile = vi.fn(ok)
    const result = await loadGaiaTiles(tails, fetchTile, () => {}, { signal: controller.signal })

    expect(fetchTile).not.toHaveBeenCalled()
    expect(result).toEqual({ loaded: 0, failed: [], aborted: false, cancelled: true })
  })

  it('отмена первого fetch не повторяется и не считается отсутствием файлов', async () => {
    const controller = new AbortController()
    const fetchTile = vi.fn((_tile: GaiaTile, signal?: AbortSignal): Promise<ArrayBuffer> =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    )
    const loading = loadGaiaTiles(tails, fetchTile, () => {}, { signal: controller.signal })
    expect(fetchTile.mock.calls[0][1]).toBe(controller.signal)
    controller.abort()

    expect(await loading).toEqual({ loaded: 0, failed: [], aborted: false, cancelled: true })
    expect(fetchTile).toHaveBeenCalledTimes(1)
  })

  it('отмена останавливает очередь и отбрасывает поздние ответы, даже если fetch игнорирует signal', async () => {
    const controller = new AbortController()
    const pending: { tile: GaiaTile; resolve: (buffer: ArrayBuffer) => void; reject: (error: Error) => void }[] = []
    let workersStarted: () => void = () => {}
    const ready = new Promise<void>(resolve => { workersStarted = resolve })
    const fetchTile = vi.fn((tile: GaiaTile): Promise<ArrayBuffer> => {
      if (tile === tails[0]) return ok(tile)
      return new Promise((resolve, reject) => {
        pending.push({ tile, resolve, reject })
        if (pending.length === 2) workersStarted()
      })
    })
    const onTile = vi.fn()
    const loading = loadGaiaTiles(tails, fetchTile, onTile, { concurrency: 2, signal: controller.signal })
    await ready
    controller.abort()
    pending[0].resolve(new ArrayBuffer(gaiaTileByteLength(pending[0].tile)))
    pending[1].reject(new Error('late network failure'))

    expect(await loading).toEqual({ loaded: 1, failed: [], aborted: false, cancelled: true })
    expect(fetchTile).toHaveBeenCalledTimes(3)
    expect(onTile).toHaveBeenCalledTimes(1)
  })
})
