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

describe('HeightFieldStorage: загрузка карт высот', () => {
  it('успешная загрузка кладёт распарсенную карту в реестр по пути', async () => {
    stubFetch(validBody())

    await heightFieldStorage.load(['planets/moon/moon_height.raw'])

    const map = heightFieldStorage.get('planets/moon/moon_height.raw')
    expect(map?.width).toBe(2)
    expect(map?.maxMeters).toBeCloseTo(100, 3)
  })

  it('повторная загрузка того же пути не дёргает сеть', async () => {
    stubFetch(validBody())

    await heightFieldStorage.load(['planets/moon/moon_height.raw'])
    await heightFieldStorage.load(['planets/moon/moon_height.raw'])

    expect(vi.mocked(fetch).mock.calls.length).toBe(1)
  })

  it('битый файл — warn и пропуск, реестр пуст, исключение не летит', async () => {
    stubFetch(Buffer.from([1, 2, 3]))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(heightFieldStorage.load(['planets/moon/moon_height.raw'])).resolves.toBeUndefined()

    expect(heightFieldStorage.get('planets/moon/moon_height.raw')).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('HTTP-ошибка — warn и пропуск', async () => {
    stubFetch(null, 404)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await heightFieldStorage.load(['planets/moon/moon_height.raw'])

    expect(heightFieldStorage.get('planets/moon/moon_height.raw')).toBeUndefined()
    warn.mockRestore()
  })

  it('clear() опустошает реестр', async () => {
    stubFetch(validBody())
    await heightFieldStorage.load(['planets/moon/moon_height.raw'])

    heightFieldStorage.clear()

    expect(heightFieldStorage.get('planets/moon/moon_height.raw')).toBeUndefined()
  })

  it('репортер получает имя ассета', async () => {
    stubFetch(validBody())
    const reporter = { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() }

    await heightFieldStorage.load(['planets/moon/moon_height.raw'], reporter)

    expect(reporter.setAsset).toHaveBeenCalledWith('planets/moon/moon_height.raw')
  })
})
