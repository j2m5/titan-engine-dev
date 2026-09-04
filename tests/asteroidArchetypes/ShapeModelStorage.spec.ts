import { vi } from 'vitest'
import { ShapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
import { encodeShapeModel } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'

const sampleBuffer = () =>
  encodeShapeModel({
    positions: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2])
  })

const okResponse = (buffer: ArrayBuffer): Response =>
  ({ ok: true, status: 200, arrayBuffer: async () => buffer }) as unknown as Response

describe('ShapeModelStorage: загрузка реальных моделей форм', () => {
  it('грузит по пути формата через Storage.url и отдаёт данные модели', async () => {
    const fetchMock = vi.fn(async () => okResponse(sampleBuffer()))
    const storage = new ShapeModelStorage(fetchMock as unknown as typeof fetch)

    const data = await storage.load('itokawa', 'l0')

    expect(data).not.toBeNull()
    expect(data!.indices.length).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(url).toContain('asteroids/shapes/itokawa_l0.bin')
  })

  it('кэширует на сессию: второй запрос того же имени и яруса не ходит в сеть', async () => {
    const fetchMock = vi.fn(async () => okResponse(sampleBuffer()))
    const storage = new ShapeModelStorage(fetchMock as unknown as typeof fetch)

    const [a, b] = await Promise.all([storage.load('bennu', 'near'), storage.load('bennu', 'near')])
    await storage.load('bennu', 'near')

    expect(a).toBe(b)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HTTP-ошибка и битый буфер → null, без исключения; повторный запрос не спамит сеть', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response)
    const storage = new ShapeModelStorage(fetchMock as unknown as typeof fetch)
    expect(await storage.load('missing', 'l0')).toBeNull()
    expect(await storage.load('missing', 'l0')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const badFetch = vi.fn(async () => okResponse(new ArrayBuffer(8)))
    const bad = new ShapeModelStorage(badFetch as unknown as typeof fetch)
    expect(await bad.load('corrupt', 'l0')).toBeNull()
  })

  it('сетевое исключение → null', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('network')
    })
    const storage = new ShapeModelStorage(failing as unknown as typeof fetch)
    expect(await storage.load('offline', 'near')).toBeNull()
  })
})
