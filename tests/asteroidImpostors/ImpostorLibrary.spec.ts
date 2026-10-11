import { BoxGeometry, DataArrayTexture, type WebGLRenderer } from 'three'
import { asteroidImpostor } from '@/config/asteroidImpostor'
import { AsteroidImpostorLibrary } from '@/core/renderables/DetailedRingStreamingSystem/impostors/AsteroidImpostorLibrary'
import { ShapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
import type { ImpostorBakerPort, ImpostorSourceDescriptor } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorTypes'
import { createImpostorAtlas } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorResources'

vi.mock('@/core/renderables/DetailedRingStreamingSystem/impostors/impostorResources', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/renderables/DetailedRingStreamingSystem/impostors/impostorResources')>()
  return { ...actual, checkImpostorCapabilities: () => ({ supported: true, samples: 4, reason: null }),
    createImpostorAtlas: vi.fn((_renderer, layout, count) => ({ layout, layerCount: count + 1, normalDepth: new DataArrayTexture(), surfaceCoverage: new DataArrayTexture(), dispose: vi.fn() })) }
})
vi.mock('@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary', () => ({
  getArchetypeGeometries: (_profile: string, count: number) => Array.from({ length: count }, () => new BoxGeometry())
}))

const source: ImpostorSourceDescriptor = { profile: 'stony', count: 14, detailL0: 2, detailNear: 3, realModels: [], sourceFingerprint: 'test:1', bakeVersion: 1 }
function setup(budgetMiB = 192, yieldToUi = async () => {}) {
  const baker: ImpostorBakerPort = { begin: vi.fn(), step: vi.fn(() => 'complete' as const), finish: vi.fn(() => ({ halfExtent: 1.05, boundRadius: 1 })), cancel: vi.fn(), dispose: vi.fn() }
  const renderer = { debug: { onShaderError: null }, getContext: () => ({ isContextLost: () => false, NO_ERROR: 0, getError: () => 0 }) } as unknown as WebGLRenderer
  const library = new AsteroidImpostorLibrary(renderer, { ...asteroidImpostor.asteroidImpostor, budgetMiB },
    new ShapeModelStorage(vi.fn()), undefined, { makeBaker: () => baker, yieldToUi })
  return { library, baker, renderer }
}

describe('Общая библиотека импосторов', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    { frameSize: 63 }, { gridSize: 1 }, { budgetMiB: -1 }, { budgetMiB: NaN },
    { loadViewsPerChunk: 0 }, { frameViewsPerChunk: 0 }, { chunkCpuMs: NaN }, { detailStartFraction: 1 }
  ])('ошибка настройки %o оставляет работоспособный legacy без GPU-подготовки', async invalid => {
    for (const enabled of [true, false]) {
      const { renderer } = setup()
      const library = new AsteroidImpostorLibrary(renderer, { ...asteroidImpostor.asteroidImpostor, enabled, ...invalid }, new ShapeModelStorage(vi.fn()))
      const lease = library.acquire(source, 0)
      expect(lease.allowsAtlas()).toBe(false)
      expect(lease.current().reason).toMatch(/настро|атлас|бюджет/i)
      await library.prepareInitial()
      expect(createImpostorAtlas).not.toHaveBeenCalled()
      library.clear()
    }
  })

  it('делит атлас и очередь, но учитывает отдельные instance-буферы и безопасные release', async () => {
    const { library, baker } = setup()
    const first = library.acquire(source, 1024), second = library.acquire(source, 2048)
    expect(first.allowsAtlas()).toBe(true)
    expect(first.current().state).toBe('legacy')
    await library.prepareInitial()
    const atlas = first.current().atlas!
    expect(atlas).not.toBeNull()
    expect(second.current().atlas).toBe(atlas)
    expect(baker.begin).toHaveBeenCalledTimes(14)
    expect(createImpostorAtlas).toHaveBeenCalledTimes(1)
    const before = library.stats().allocatedBytes
    first.release(); first.release()
    expect(library.stats().allocatedBytes).toBe(before - 1024)
    expect(atlas.dispose).not.toHaveBeenCalled()
    second.release(); second.release()
    expect(atlas.dispose).toHaveBeenCalledTimes(1)
    expect(library.stats().libraries).toBe(0)
    library.clear()
    expect(library.stats().reservedBytes + library.stats().allocatedBytes).toBe(0)
  })

  it('публикует initial только после всех слотов и уступает управление UI', async () => {
    const yieldUi = vi.fn(async () => {}), { library, baker } = setup(192, yieldUi)
    const lease = library.acquire({ ...source, count: 3 }, 0)
    const prepare = vi.fn(() => ({ commit: vi.fn(), dispose: vi.fn() }))
    lease.subscribe({ prepare })
    library.pumpFrame()
    expect(lease.current().state).toBe('legacy')
    expect(baker.step).toHaveBeenLastCalledWith(2, 2)
    await library.prepareInitial()
    expect(lease.current().state).toBe('ready')
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(yieldUi).toHaveBeenCalled()
    expect(baker.step).toHaveBeenLastCalledWith(8, 2)
    library.clear()
  })

  it('четыре библиотеки входят в 192 MiB; пятая не создаёт атлас или instance-буферы', async () => {
    const { library } = setup()
    const leases = Array.from({ length: 5 }, (_, i) => library.acquire({ ...source, sourceFingerprint: 'source:' + i }, 1024 * 1024))
    expect(leases.map(l => l.allowsAtlas())).toEqual([true, true, true, true, false])
    await library.prepareInitial()
    expect(leases.map(l => l.current().state)).toEqual(['ready', 'ready', 'ready', 'ready', 'legacy'])
    expect(createImpostorAtlas).toHaveBeenCalledTimes(4)
    expect(library.stats().peakBytes).toBeLessThanOrEqual(192 * 1024 * 1024)
    library.clear()
  })

  it('отказ атрибутов одного арендатора не портит готовую общую библиотеку', async () => {
    const { library } = setup()
    const first = library.acquire(source, 0)
    await library.prepareInitial()
    const refused = library.acquire(source, 192 * 1024 * 1024)
    expect(refused.allowsAtlas()).toBe(false)
    expect(refused.current().state).toBe('legacy')
    expect(first.current().state).toBe('ready')
    refused.release(); library.clear()
  })

  it('различает detail и fingerprint и отказывает до создания GPU-ресурсов', async () => {
    const { library } = setup(1)
    const lease = library.acquire(source, 8)
    expect(lease.allowsAtlas()).toBe(false)
    await library.prepareInitial()
    expect(createImpostorAtlas).not.toHaveBeenCalled()
    library.clear()
    const normal = setup().library
    const leases = [normal.acquire(source, 0), normal.acquire({ ...source, detailL0: 1 }, 0), normal.acquire({ ...source, sourceFingerprint: 'another' }, 0)]
    await normal.prepareInitial()
    expect(new Set(leases.map(l => l.current().atlas)).size).toBe(3)
    normal.clear()
  })

  it('clear во время initial не публикует старые jobs и завершает promise', async () => {
    let cancel = () => {}
    const { library, baker } = setup(192, async () => cancel())
    cancel = () => library.clear()
    const lease = library.acquire(source, 0), publish = vi.fn(() => ({ commit: vi.fn(), dispose: vi.fn() }))
    lease.subscribe({ prepare: publish })
    await library.prepareInitial()
    expect(publish).not.toHaveBeenCalled()
    expect(baker.begin).toHaveBeenCalledTimes(1)
    expect(library.stats().libraries).toBe(0)
    expect(lease.current().state).toBe('legacy')
  })

  it('сбой страницы оставляет соседнюю библиотеку рабочей', async () => {
    const { library, baker } = setup()
    vi.mocked(baker.step).mockImplementationOnce(() => { throw new Error('broken framebuffer') })
    const a = library.acquire(source, 0), b = library.acquire({ ...source, sourceFingerprint: 'b' }, 0)
    await library.prepareInitial()
    expect(a.current().state).toBe('legacy')
    expect(a.current().reason).toContain('broken framebuffer')
    expect(b.current().state).toBe('ready')
    library.clear()
  })

  it('ловит shader error, даже если renderer.render не бросил исключение', async () => {
    const { library, baker, renderer } = setup()
    vi.mocked(baker.step).mockImplementationOnce(() => {
      renderer.debug.onShaderError?.(renderer.getContext(), {} as Parameters<NonNullable<typeof renderer.debug.onShaderError>>[1], {} as WebGLShader, {} as WebGLShader)
      return 'complete'
    })
    const lease = library.acquire(source, 0)
    await library.prepareInitial()
    expect(lease.current().state).toBe('legacy')
    expect(lease.current().reason).toContain('шейдер')
    expect(renderer.debug.onShaderError).toBeNull()
    library.clear()
  })

  it('ошибка GL от сломанной программы не отключает следующую библиотеку', async () => {
    const { library, baker, renderer } = setup()
    let pendingError = 0
    const gl = { ...renderer.getContext(), getError: () => { const error = pendingError; pendingError = 0; return error } }
    vi.spyOn(renderer, 'getContext').mockReturnValue(gl as WebGL2RenderingContext)
    vi.mocked(baker.step).mockImplementationOnce(() => {
      pendingError = 1282
      renderer.debug.onShaderError?.(renderer.getContext(), {} as Parameters<NonNullable<typeof renderer.debug.onShaderError>>[1], {} as WebGLShader, {} as WebGLShader)
      return 'complete'
    })
    const failed = library.acquire(source, 0), neighbour = library.acquire({ ...source, sourceFingerprint: 'neighbour' }, 0)
    await library.prepareInitial()
    expect(failed.current().state).toBe('legacy')
    expect(neighbour.current().state).toBe('ready')
    expect(pendingError).toBe(0)
    library.clear()
  })

  it('warmup выполняется один раз, материалы остаются до clear', async () => {
    const { library } = setup(), warm = vi.fn(async () => {}), release = vi.fn(), duplicate = vi.fn()
    library.registerWarmup('ice', warm, release)
    library.registerWarmup('ice', warm, duplicate)
    await library.prepareInitial(); await library.prepareInitial()
    expect(warm).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
    expect(duplicate).toHaveBeenCalledTimes(1)
    library.clear(); library.clear()
    expect(release).toHaveBeenCalledTimes(1)
  })
})
