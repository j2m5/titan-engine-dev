import { afterEach, describe, expect, it, vi } from 'vitest'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { encodeHeightMap } from '../../scripts/lib/heightMapEncode'

function stubFetch(body: Buffer | null, status: number = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () =>
        body ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0)
    }))
  )
}

function validBody(): Buffer {
  return encodeHeightMap({ width: 2, height: 2, minMeters: 0, maxMeters: 100, data: new Uint16Array([0, 1, 2, 3]) })
}

afterEach(() => {
  heightFieldStorage.clear()
  vi.unstubAllGlobals()
})

/** Даёт fetch-стабу доехать: request() промис не возвращает, ждать нечего. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Тело ответа потоком. Не `new Blob([body]).stream()`: у jsdom-Blob метода
 * stream() нет, а среда тестов — jsdom (src/config тянет window).
 */
function streamOf(body: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(body))
      controller.close()
    }
  })
}

/** fetch, отдающий тело ПОТОКОМ чанками — preloadHeaders обязан отменить чтение после заголовка. */
function stubStreamingFetch(body: Buffer, chunkBytes: number): { cancelled: () => boolean; pulls: () => number } {
  let cancelled = false
  let pulls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          // отдаём по чанку за вызов
          const offset = (controller as unknown as { offset?: number }).offset ?? 0
          if (offset >= body.length) return controller.close()
          pulls += 1
          controller.enqueue(new Uint8Array(body.subarray(offset, offset + chunkBytes)))
          ;(controller as unknown as { offset: number }).offset = offset + chunkBytes
        },
        cancel() {
          cancelled = true
        }
      },
      // highWaterMark 0 — поток не тянет чанк впрок: счётчик pull равен числу
      // чанков, которые фактически понадобились читателю
      { highWaterMark: 0 })
    }))
  )
  return { cancelled: () => cancelled, pulls: () => pulls }
}

describe('HeightFieldStorage: спросовый режим', () => {
  it('request загружает карту и поднимает версию', async () => {
    stubFetch(validBody())
    const before = heightFieldStorage.version

    heightFieldStorage.request('planets/moon/moon_height.raw')
    await settle()

    expect(heightFieldStorage.get('planets/moon/moon_height.raw')?.width).toBe(2)
    expect(heightFieldStorage.version).toBeGreaterThan(before)
  })

  it('повторный request не дёргает сеть второй раз', async () => {
    stubFetch(validBody())

    heightFieldStorage.request('planets/moon/moon_height.raw')
    await settle()
    heightFieldStorage.request('planets/moon/moon_height.raw')
    await settle()

    expect(vi.mocked(fetch).mock.calls.length).toBe(1)
  })

  it('request во время полёта той же карты не дёргает сеть второй раз', async () => {
    stubFetch(validBody())

    heightFieldStorage.request('planets/moon/moon_height.raw')
    heightFieldStorage.request('planets/moon/moon_height.raw')
    await settle()

    expect(vi.mocked(fetch).mock.calls.length).toBe(1)
  })

  it('release освобождает карту и поднимает версию', async () => {
    stubFetch(validBody())
    heightFieldStorage.request('planets/moon/moon_height.raw')
    await settle()
    const afterLoad = heightFieldStorage.version

    heightFieldStorage.release('planets/moon/moon_height.raw')

    expect(heightFieldStorage.get('planets/moon/moon_height.raw')).toBeUndefined()
    expect(heightFieldStorage.version).toBeGreaterThan(afterLoad)
  })

  it('release неизвестного пути версию не трогает', () => {
    const before = heightFieldStorage.version

    heightFieldStorage.release('planets/moon/moon_height.raw')

    expect(heightFieldStorage.version).toBe(before)
  })

  it('карта в полёте переживает release и всё равно доезжает', async () => {
    stubFetch(validBody())

    heightFieldStorage.request('planets/moon/moon_height.raw')
    heightFieldStorage.release('planets/moon/moon_height.raw')
    await settle()

    expect(heightFieldStorage.get('planets/moon/moon_height.raw')?.width).toBe(2)
  })

  it('heldPaths считает и загруженные, и летящие', async () => {
    stubFetch(validBody())

    heightFieldStorage.request('planets/moon/moon_height.raw')
    expect(heightFieldStorage.heldPaths()).toEqual(['planets/moon/moon_height.raw'])

    await settle()
    expect(heightFieldStorage.heldPaths()).toEqual(['planets/moon/moon_height.raw'])
  })

  it('смена сценария во время полёта выбрасывает результат устаревшей загрузки', async () => {
    stubFetch(validBody())

    heightFieldStorage.request('planets/moon/moon_height.raw')
    heightFieldStorage.clear()
    await settle()

    expect(heightFieldStorage.get('planets/moon/moon_height.raw')).toBeUndefined()
    expect(heightFieldStorage.heldPaths()).toEqual([])
  })

  it('провал сети не повторяется до истечения бэкоффа', async () => {
    stubFetch(null, 500)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    heightFieldStorage.request('planets/moon/moon_height.raw')
    await settle()
    heightFieldStorage.request('planets/moon/moon_height.raw')
    await settle()

    expect(vi.mocked(fetch).mock.calls.length).toBe(1)
    expect(heightFieldStorage.heldPaths()).toEqual([])
    warn.mockRestore()
  })

  it('после истечения бэкоффа попытка повторяется', async () => {
    stubFetch(null, 500)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(0)

    heightFieldStorage.request('planets/moon/moon_height.raw')
    await settle()

    nowSpy.mockReturnValue(31_000)
    heightFieldStorage.request('planets/moon/moon_height.raw')
    await settle()

    expect(vi.mocked(fetch).mock.calls.length).toBe(2)
    nowSpy.mockRestore()
    warn.mockRestore()
  })
})

describe('HeightFieldStorage: заголовки карт (preloadHeaders / floorMeters)', () => {
  // Заголовки переживают clear() по построению — межтестовую изоляцию держим здесь
  afterEach(() => {
    ;(heightFieldStorage as unknown as { headers: Map<string, unknown> }).headers.clear()
  })

  it('читает minMeters из первых байт и отменяет поток, не дожидаясь тела', async () => {
    const big = encodeHeightMap({ width: 64, height: 32, minMeters: -8174.25, maxMeters: 21171.5, data: new Uint16Array(64 * 32) })
    const stream = stubStreamingFetch(big, 16) // чанки по 16 байт — заголовок приходит за два

    await heightFieldStorage.preloadHeaders(['planets/mars/mars_height.raw'])

    expect(heightFieldStorage.floorMeters('planets/mars/mars_height.raw')).toBeCloseTo(-8174.25, 2)
    expect(heightFieldStorage.get('planets/mars/mars_height.raw')).toBeUndefined() // полной карты нет
    expect(stream.cancelled()).toBe(true)
    // 24 байта заголовка = два чанка по 16; всё тело — 257 чанков
    expect(stream.pulls()).toBe(2)
  })

  it('провал одного пути не валит остальные и не бросает', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const good = encodeHeightMap({ width: 2, height: 2, minMeters: -5, maxMeters: 5, data: new Uint16Array(4) })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('bad')
          ? { ok: false, status: 404, body: null }
          : { ok: true, status: 200, body: streamOf(good) }
      )
    )

    await expect(heightFieldStorage.preloadHeaders(['x/bad_height.raw', 'x/good_height.raw'])).resolves.toBeUndefined()
    expect(heightFieldStorage.floorMeters('x/bad_height.raw')).toBeUndefined()
    expect(heightFieldStorage.floorMeters('x/good_height.raw')).toBe(-5)
    warn.mockRestore()
  })

  it('провалы сводятся в ОДИН warn со счётом и списком путей', async () => {
    // Деградация (пол 0 у всех перечисленных тел) должна читаться с одного
    // взгляда, а не собираться из N строк консоли.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, body: null })))

    await heightFieldStorage.preloadHeaders(['x/a_height.raw', 'x/b_height.raw', 'x/c_height.raw'])

    expect(warn).toHaveBeenCalledTimes(1)
    const message: string = String(warn.mock.calls[0][0])
    expect(message).toContain('(3)')
    for (const path of ['x/a_height.raw', 'x/b_height.raw', 'x/c_height.raw']) expect(message).toContain(path)
    warn.mockRestore()
  })

  it('все заголовки прочитаны — консоль молчит', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const good = encodeHeightMap({ width: 2, height: 2, minMeters: -5, maxMeters: 5, data: new Uint16Array(4) })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, body: streamOf(good) })))

    await heightFieldStorage.preloadHeaders(['x/good_height.raw'])

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('полная карта в реестре имеет приоритет над заголовком; заголовок переживает clear()', async () => {
    const good = encodeHeightMap({ width: 2, height: 2, minMeters: -5, maxMeters: 5, data: new Uint16Array(4) })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, body: streamOf(good) })))
    await heightFieldStorage.preloadHeaders(['x/good_height.raw'])

    heightFieldStorage.clear()
    expect(heightFieldStorage.floorMeters('x/good_height.raw')).toBe(-5)

    ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set('x/good_height.raw', {
      width: 2, height: 2, minMeters: -7, maxMeters: 5, data: new Uint16Array(4)
    })
    expect(heightFieldStorage.floorMeters('x/good_height.raw')).toBe(-7)
  })
})
