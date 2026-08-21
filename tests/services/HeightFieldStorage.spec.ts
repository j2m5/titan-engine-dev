import { afterEach, describe, expect, it, vi } from 'vitest'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { encodeHeightMap } from '../../scripts/lib/heightMapEncode'
import { encodeTerrainAux } from '../../scripts/lib/terrainAuxEncode'

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

describe('HeightFieldStorage: компаньон карты высот', () => {
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
        aux.nodeMaxHeightMetersPyramid!.byteLength
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
