import { afterEach, describe, expect, it, vi } from 'vitest'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { config } from '@/core/framework/config'
import { parseHeightMap, type HeightMapData } from '@/core/terrain/heightMapFormat'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { disposeTerrainShadowMaps, terrainShadowMapFor } from '@/core/terrain/terrainShadowMap'
import { encodeHeightMap } from '../../scripts/lib/heightMapEncode'
import { encodeTerrainAux } from '../../scripts/lib/terrainAuxEncode'
import { decideHeightMaps } from '@/core/terrain/heightMapGatePolicy'

const MAP_PATH = 'planets/moon/moon_height.raw'
const AUX_PATH = 'planets/moon/moon_height.aux'

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

/**
 * Карта и её компаньон — разные URL, поэтому стаб отвечает по адресу.
 * `aux === undefined` означает «штатный компаньон, посчитанный из этой же
 * карты»: так выглядит продакшен после запечки, и тесты, которым компаньон
 * безразличен, не должны сидеть на аварийной ветке. Явный `null` — компаньона
 * на сервере нет (404).
 */
function stubFetch(body: Buffer | null, status: number = 200, aux?: Buffer | null): void {
  const auxBody: Buffer | null = aux === undefined ? (body ? auxFor(body) : null) : aux

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const isAux = String(url).endsWith('.aux')
      const payload: Buffer | null = isAux ? auxBody : body
      const code = isAux ? (auxBody ? 200 : 404) : status

      return {
        ok: code >= 200 && code < 300,
        status: code,
        arrayBuffer: async () => (payload ? toArrayBuffer(payload) : new ArrayBuffer(0))
      }
    })
  )
}

/** Обращений к САМОЙ карте: компаньон едет своим запросом и в этот счёт не входит. */
function mapFetchCount(): number {
  return vi.mocked(fetch).mock.calls.filter((call) => !String(call[0]).endsWith('.aux')).length
}

function validBody(): Buffer {
  return encodeHeightMap({ width: 2, height: 2, minMeters: 0, maxMeters: 100, data: new Uint16Array([0, 1, 2, 3]) })
}

function smallMap(): HeightMapData {
  return { width: 4, height: 2, minMeters: 0, maxMeters: 100, data: new Uint16Array(8) }
}

/** Настоящий компаньон настоящей карты — через то же поле, что строит его офлайн-скрипт. */
function auxFor(body: Buffer): Buffer {
  const map = parseHeightMap(toArrayBuffer(body))

  return encodeTerrainAux(new TerrainHeightField(map, 1737.4).exportAux(), map)
}

afterEach(() => {
  heightFieldStorage.clear()
  vi.unstubAllGlobals()
})

/** Даёт fetch-стабу доехать: request() промис не возвращает, ждать нечего. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
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

    expect(mapFetchCount()).toBe(1)
  })

  it('request во время полёта той же карты не дёргает сеть второй раз', async () => {
    stubFetch(validBody())

    heightFieldStorage.request('planets/moon/moon_height.raw')
    heightFieldStorage.request('planets/moon/moon_height.raw')
    await settle()

    expect(mapFetchCount()).toBe(1)
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

  it('release discards an in-flight response even if fetch ignores cancellation', async () => {
    stubFetch(validBody())

    heightFieldStorage.request('planets/moon/moon_height.raw')
    heightFieldStorage.release('planets/moon/moon_height.raw')
    await settle()

    expect(heightFieldStorage.get('planets/moon/moon_height.raw')).toBeUndefined()
    expect(heightFieldStorage.heldPaths()).toEqual([])
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

    expect(mapFetchCount()).toBe(1)
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

    expect(mapFetchCount()).toBe(2)
    nowSpy.mockRestore()
    warn.mockRestore()
  })
})

/** fetch, который никогда не отвечает сам, но честно отклоняется по сигналу отмены. */
function stubHangingFetch(): AbortSignal[] {
  const signals: AbortSignal[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal
          if (!signal) return
          signals.push(signal)
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')))
        })
    )
  )
  return signals
}

function rejectOnAbort<T>(signal: AbortSignal): Promise<T> {
  return new Promise((_resolve, reject) => {
    signal.throwIfAborted()
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

describe('HeightFieldStorage: отмена и таймаут загрузки', () => {
  it('release cancels both requests immediately without imposing retry backoff', async () => {
    const signals = stubHangingFetch()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      heightFieldStorage.request(MAP_PATH)
      heightFieldStorage.release(MAP_PATH)
      expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
      expect(heightFieldStorage.heldPaths()).toEqual([])
      await settle()
      heightFieldStorage.request(MAP_PATH)
      expect(mapFetchCount()).toBe(2)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it.each(['success', 'failure'])('late old %s cannot publish or release a replacement request', async (outcome) => {
    const pending: Array<{ resolve(response: Response): void; reject(reason: Error): void }> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }))))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const body = validBody()
    const response = (payload: Buffer): Response => ({ ok: true, arrayBuffer: async () => toArrayBuffer(payload) }) as Response
    try {
      heightFieldStorage.request(MAP_PATH)
      heightFieldStorage.release(MAP_PATH)
      heightFieldStorage.request(MAP_PATH)
      expect(pending).toHaveLength(4)
      if (outcome === 'success') pending[0].resolve(response(body))
      else pending[0].reject(new Error('late old failure'))
      pending[1].resolve(response(auxFor(body)))
      await settle()
      expect(heightFieldStorage.get(MAP_PATH)).toBeUndefined()
      expect(heightFieldStorage.heldPaths()).toEqual([MAP_PATH])
      heightFieldStorage.request(MAP_PATH)
      expect(pending).toHaveLength(4)
      pending[2].resolve(response(body))
      pending[3].resolve(response(auxFor(body)))
      await settle()
      expect(heightFieldStorage.get(MAP_PATH)?.width).toBe(2)
      expect(warn).not.toHaveBeenCalled()
      heightFieldStorage.release(MAP_PATH)
      stubFetch(body)
      heightFieldStorage.request(MAP_PATH)
      await settle()
      expect(heightFieldStorage.get(MAP_PATH)?.width).toBe(2)
    } finally {
      // Settle even after a failed assertion so intentionally uncooperative fetches leave no timers.
      for (const request of pending) request.resolve(response(body))
      await settle()
      warn.mockRestore()
    }
  })

  it('candidate churn holds only one admitted budget of unfinished downloads', async () => {
    const signals = stubHangingFetch()
    for (let batch = 0; batch < 3; batch++) {
      const candidates = Array.from({ length: 4 }, (_, index) => ({ path: `${batch}-${index}.raw`, actorPriority: 1 }))
      const decision = decideHeightMaps(candidates, heightFieldStorage.heldPaths(), 0.5, 0.25,
        (path) => heightFieldStorage.bytesOf(path), 512 * 1024 * 1024, 2)
      for (const path of decision.release) heightFieldStorage.release(path)
      for (const path of decision.request) heightFieldStorage.request(path)
      expect(heightFieldStorage.heldPaths()).toEqual(candidates.map((candidate) => candidate.path))
      expect(signals.filter((signal) => !signal.aborted)).toHaveLength(8)
      await settle()
    }
  })

  it('clear() обрывает загрузки прошлого сценария — и карту, и компаньон, без предупреждений', async () => {
    const signals = stubHangingFetch()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    heightFieldStorage.request(MAP_PATH)
    expect(signals).toHaveLength(2)
    heightFieldStorage.clear()
    await settle()

    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    // новый сценарий запрашивает тот же путь заново — сеть не заблокирована старым полётом
    heightFieldStorage.request(MAP_PATH)
    expect(mapFetchCount()).toBe(2)
    warn.mockRestore()
  })

  it('зависшая загрузка снимается по таймауту: путь не пинится, дальше обычный бэкофф', async () => {
    vi.useFakeTimers()
    try {
      const signals = stubHangingFetch()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      heightFieldStorage.request(MAP_PATH)
      expect(heightFieldStorage.heldPaths()).toEqual([MAP_PATH])
      await vi.advanceTimersByTimeAsync(config('streaming.heightMapTimeoutMs'))

      expect(signals.every((signal) => signal.aborted)).toBe(true)
      expect(heightFieldStorage.heldPaths()).toEqual([])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('карта высот не загружена')
      warn.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })

  it('карта не пришла — одно предупреждение о карте, о компаньоне молчим', async () => {
    stubFetch(null, 404, null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    heightFieldStorage.request(MAP_PATH)
    await settle()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('карта высот не загружена')
    warn.mockRestore()
  })

  it.each(['headers', 'body'])('rejects map %s arriving after the deadline even if cancellation is ignored', async (stage) => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let finishMap!: () => void
    const arrival = new Promise<void>((resolve) => { finishMap = resolve })
    const body = validBody()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('.aux')) return new Response(null, { status: 404 })
      if (stage === 'headers') await arrival
      const response = new Response()
      vi.spyOn(response, 'arrayBuffer').mockImplementation(async () => {
        if (stage === 'body') await arrival
        return toArrayBuffer(body)
      })
      return response
    }))
    const before = heightFieldStorage.version
    try {
      heightFieldStorage.request(MAP_PATH)
      await vi.advanceTimersByTimeAsync(config('streaming.heightMapTimeoutMs'))
      finishMap()
      await vi.advanceTimersByTimeAsync(0)

      expect(heightFieldStorage.get(MAP_PATH)).toBeUndefined()
      expect(heightFieldStorage.heldPaths()).toEqual([])
      expect(heightFieldStorage.version).toBe(before)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('карта высот не загружена')
      heightFieldStorage.request(MAP_PATH)
      expect(mapFetchCount()).toBe(1)
    } finally {
      finishMap()
      heightFieldStorage.clear()
      await vi.advanceTimersByTimeAsync(0)
      vi.useRealTimers()
      warn.mockRestore()
    }
  })

  it.each(['release', 'clear'])('%s while awaiting auxiliary data cannot overwrite the same-path replacement', async (cancel) => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let finishAux!: (response: Response) => void
    const auxPending = new Promise<Response>((resolve) => { finishAux = resolve })
    const body = validBody()
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).endsWith('.aux') ? auxPending : new Response(toArrayBuffer(body))))
    try {
      heightFieldStorage.request(MAP_PATH)
      await vi.advanceTimersByTimeAsync(0)
      if (cancel === 'clear') heightFieldStorage.clear()
      else heightFieldStorage.release(MAP_PATH)

      const replacement = encodeHeightMap({
        width: 2, height: 2, minMeters: 0, maxMeters: 100, data: new Uint16Array([4, 5, 6, 7])
      })
      stubFetch(replacement)
      heightFieldStorage.request(MAP_PATH)
      await vi.advanceTimersByTimeAsync(0)
      const current = heightFieldStorage.get(MAP_PATH)
      expect(Array.from(current!.data)).toEqual([4, 5, 6, 7])
      const currentVersion = heightFieldStorage.version

      finishAux(new Response(toArrayBuffer(auxFor(body))))
      await vi.advanceTimersByTimeAsync(0)

      expect(heightFieldStorage.get(MAP_PATH)).toBe(current)
      expect(heightFieldStorage.version).toBe(currentVersion)
      expect(heightFieldStorage.heldPaths()).toEqual([MAP_PATH])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      finishAux(new Response(null, { status: 404 }))
      heightFieldStorage.clear()
      await vi.advanceTimersByTimeAsync(0)
      vi.useRealTimers()
      warn.mockRestore()
    }
  })
})

describe('HeightFieldStorage: компаньон карты высот', () => {
  it.each(['headers', 'body'])('keeps the ready heightmap when auxiliary %s time out', async (stage) => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const body = validBody()
    let auxSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).endsWith('.aux')) return new Response(toArrayBuffer(body))
      auxSignal = init!.signal!
      if (stage === 'headers') return rejectOnAbort<Response>(auxSignal)
      const response = new Response()
      vi.spyOn(response, 'arrayBuffer').mockImplementation(() => rejectOnAbort<ArrayBuffer>(auxSignal!))
      return response
    }))
    const before = heightFieldStorage.version
    try {
      heightFieldStorage.request(MAP_PATH)
      await vi.advanceTimersByTimeAsync(0)
      // Publication must stay atomic while the companion can still arrive.
      expect(heightFieldStorage.get(MAP_PATH)).toBeUndefined()
      expect(heightFieldStorage.version).toBe(before)

      await vi.advanceTimersByTimeAsync(config('streaming.heightMapTimeoutMs'))

      const map = heightFieldStorage.get(MAP_PATH)
      expect(map).toBeDefined()
      expect(Array.from(map!.data)).toEqual([0, 1, 2, 3])
      expect(map!.aux).toBeUndefined()
      expect(heightFieldStorage.version).toBe(before + 1)
      expect(heightFieldStorage.heldPaths()).toEqual([MAP_PATH])
      expect(auxSignal?.aborted).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain(AUX_PATH)
      expect(String(warn.mock.calls[0][0])).toContain('таймаут')

      heightFieldStorage.request(MAP_PATH)
      expect(mapFetchCount()).toBe(1)
    } finally {
      heightFieldStorage.clear()
      await vi.advanceTimersByTimeAsync(0)
      vi.useRealTimers()
      warn.mockRestore()
    }
  })

  it('компаньон едет своим запросом по производному пути и прикрепляется к карте', async () => {
    stubFetch(validBody())

    heightFieldStorage.request(MAP_PATH)
    await settle()

    expect(vi.mocked(fetch).mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining(MAP_PATH),
      expect.stringContaining(AUX_PATH)
    ])
    expect(heightFieldStorage.get(MAP_PATH)?.aux?.blocksX).toBe(2)
  })

  it('карта публикуется в реестр РОВНО ОДИН раз, уже с компаньоном', async () => {
    // атомарность несущая: поле высот кешируется по ССЫЛКЕ на карту
    // (terrainHeightFieldFor), и публикация карты без компаньона с
    // дозаписью после означала бы поле, посчитанное вручную и закешированное
    // на весь сеанс — ровно тот фриз, который компаньон убирает
    stubFetch(validBody())
    const before = heightFieldStorage.version

    heightFieldStorage.request(MAP_PATH)
    await settle()

    expect(heightFieldStorage.version).toBe(before + 1)
    expect(heightFieldStorage.get(MAP_PATH)?.aux).toBeDefined()
  })

  it('компаньона нет на сервере — карта всё равно доезжает, поле посчитает блоки само', async () => {
    stubFetch(validBody(), 200, null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    heightFieldStorage.request(MAP_PATH)
    await settle()

    expect(heightFieldStorage.get(MAP_PATH)?.width).toBe(2)
    expect(heightFieldStorage.get(MAP_PATH)?.aux).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(AUX_PATH), expect.anything())
    warn.mockRestore()
  })

  it('битый компаньон карту не роняет — она доезжает без него', async () => {
    stubFetch(validBody(), 200, Buffer.from('это не компаньон'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    heightFieldStorage.request(MAP_PATH)
    await settle()

    expect(heightFieldStorage.get(MAP_PATH)?.width).toBe(2)
    expect(heightFieldStorage.get(MAP_PATH)?.aux).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('компаньон от другой версии карты отбрасывается с указанием причины', async () => {
    const stale = encodeHeightMap({
      width: 2,
      height: 2,
      minMeters: 0,
      maxMeters: 100,
      data: new Uint16Array([9, 9, 9, 9])
    })
    stubFetch(validBody(), 200, auxFor(stale))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    heightFieldStorage.request(MAP_PATH)
    await settle()

    expect(heightFieldStorage.get(MAP_PATH)?.aux).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/отпечат/i), expect.anything())
    warn.mockRestore()
  })
})

describe('HeightFieldStorage: учёт занятой памяти', () => {
  it('незагруженный путь размера не имеет — политика бюджета посчитает его по максимуму', () => {
    expect(heightFieldStorage.bytesOf(MAP_PATH)).toBeUndefined()
  })

  it('без компаньона — ровно тело карты', async () => {
    stubFetch(validBody(), 200, null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    heightFieldStorage.request(MAP_PATH)
    await settle()

    expect(heightFieldStorage.bytesOf(MAP_PATH)).toBe(heightFieldStorage.get(MAP_PATH)!.data.byteLength)
    warn.mockRestore()
  })

  it('с компаньоном — тело плюс запечённые блоки: они такая же резидентная память', async () => {
    stubFetch(validBody())

    heightFieldStorage.request(MAP_PATH)
    await settle()

    const map = heightFieldStorage.get(MAP_PATH)!
    const aux = map.aux!

    expect(heightFieldStorage.bytesOf(MAP_PATH)).toBe(
      map.data.byteLength +
        aux.clearanceGrid.byteLength +
        aux.levelErrorMeters.byteLength +
        aux.nodeMaxHeightMetersPyramid!.byteLength +
        aux.nodeErrorMetersPyramid!.byteLength
    )
  })

  it('отпущенная карта снова без размера', async () => {
    stubFetch(validBody())
    heightFieldStorage.request(MAP_PATH)
    await settle()

    heightFieldStorage.release(MAP_PATH)

    expect(heightFieldStorage.bytesOf(MAP_PATH)).toBeUndefined()
  })
})

describe('HeightFieldStorage: карта тени уходит вместе с картой', () => {
  afterEach(() => {
    heightFieldStorage.clear()
    disposeTerrainShadowMaps()
    vi.unstubAllGlobals()
  })

  it('release(path) диспозит текстуру тени этой карты', async () => {
    stubFetch(encodeHeightMap(smallMap()))
    heightFieldStorage.request(MAP_PATH)
    await vi.waitFor(() => expect(heightFieldStorage.get(MAP_PATH)).toBeDefined())
    const map = heightFieldStorage.get(MAP_PATH)!
    let disposed = 0
    terrainShadowMapFor(map).texture.addEventListener('dispose', () => disposed++)
    heightFieldStorage.release(MAP_PATH)
    expect(disposed).toBe(1)
    expect(heightFieldStorage.get(MAP_PATH)).toBeUndefined()
  })

  it('clear() диспозит все карты тени', async () => {
    stubFetch(encodeHeightMap(smallMap()))
    heightFieldStorage.request(MAP_PATH)
    await vi.waitFor(() => expect(heightFieldStorage.get(MAP_PATH)).toBeDefined())
    let disposed = 0
    terrainShadowMapFor(heightFieldStorage.get(MAP_PATH)!).texture.addEventListener('dispose', () => disposed++)
    heightFieldStorage.clear()
    expect(disposed).toBe(1)
  })
})
