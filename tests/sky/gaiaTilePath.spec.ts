import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchGaiaTile } from '@/core/sky/GaiaSky'
import { gaiaTilePath, gaiaTiles } from '@/core/sky/gaiaTiles'

describe('путь тайла Gaia: общий для рантайма и манифеста облака', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('путь — sky/gaia/<имя>.dat', () => {
    expect(gaiaTilePath({ name: 'pos-x-0-0-0' })).toBe('sky/gaia/pos-x-0-0-0.dat')
  })

  it('fetchGaiaTile запрашивает файл по gaiaTilePath', async () => {
    const tile = gaiaTiles()[0]
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchGaiaTile(tile)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0].endsWith(`/${gaiaTilePath(tile)}`)).toBe(true)
  })
})
