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
