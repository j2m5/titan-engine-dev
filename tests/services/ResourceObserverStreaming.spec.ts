import { describe, it, expect, vi } from 'vitest'
import { Mesh, Scene, Texture } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget, textureBytes } from '@/core/streaming/TextureBudget'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { SceneObserver, ObservableRecord } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'

/** Собирает наблюдателя с подконтрольным SceneObserver и щедрым бюджетом. */
function makeObserver(budgetBytes: number = textureBytes(8192, 4096) * 8) {
  const handlers: Record<string, (event: ObservableRecord) => Promise<void>> = {}
  const data: Map<string, ObservableRecord> = new Map()

  const sceneObserver = {
    subscribe: vi.fn((event: string, handler: (e: ObservableRecord) => Promise<void>): void => {
      handlers[event] = handler
    }),
    data
  } as unknown as SceneObserver

  const loaded: string[] = []
  const textures = {
    load: vi.fn(() => {
      const texture = new Texture()
      texture.image = { width: 2048, height: 1024 }

      return Promise.resolve({ ok: true as const, texture })
    })
  } as unknown as TextureProvider

  const scene = new Scene()
  const observer = new ResourceObserver(
    sceneObserver,
    textures,
    { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() } as unknown as LoadingProgressReporter,
    { dispatch: vi.fn() } as unknown as NotificationSink,
    scene,
    new TextureBudget(budgetBytes)
  )

  return { observer, handlers, data, scene, textures, loaded }
}

describe('ResourceObserver: стриминг', () => {
  it('подписывается на ClosestChange', () => {
    const { handlers } = makeObserver()

    expect(typeof handlers['ClosestChange']).toBe('function')
  })

  it('порядок при вытеснении: материал сбрасывается ДО освобождения текстуры', async () => {
    // Если освободить раньше сброса, кадр между шагами рисуется освобождённой
    // текстурой. Проверяется порядком вызовов, а не фактом каждого.
    const order: string[] = []
    const { observer, scene } = makeObserver()

    const mesh = new Mesh()
    mesh.name = 'Earth'
    const material = { resetMaterial: (): void => void order.push('reset'), updateMaterial: vi.fn() }
    Object.defineProperty(mesh, 'renderable', { value: { material }, writable: true })
    scene.add(mesh)

    const texture = new Texture()
    texture.name = 'planets/earth.jpg'
    resourceStorage.addTexture(texture)
    vi.spyOn(resourceStorage, 'deleteTexture').mockImplementation((): void => void order.push('delete'))

    observer.evictActor({ actorId: 1, name: 'Earth', priority: 0, paths: ['planets/earth.jpg'] })

    expect(order).toEqual(['reset', 'delete'])

    vi.restoreAllMocks()
    resourceStorage.deleteAllTextures()
  })

  it('сбрасывает материал только выселяемого актора', async () => {
    const { observer, scene } = makeObserver()
    const resets: string[] = []

    for (const name of ['Earth', 'Mars']) {
      const mesh = new Mesh()
      mesh.name = name
      const material = { resetMaterial: (): void => void resets.push(name), updateMaterial: vi.fn() }
      Object.defineProperty(mesh, 'renderable', { value: { material }, writable: true })
      scene.add(mesh)
    }

    observer.evictActor({ actorId: 1, name: 'Earth', priority: 0, paths: [] })

    expect(resets).toEqual(['Earth'])
  })
})
