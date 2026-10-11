import { BoxGeometry, DataArrayTexture, type BufferGeometry, type WebGLRenderer } from 'three'
import { asteroidImpostor } from '@/config/asteroidImpostor'
import { AsteroidImpostorLibrary } from '@/core/renderables/DetailedRingStreamingSystem/impostors/AsteroidImpostorLibrary'
import type { ShapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
import type { ShapeModelData } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'
import type { ImpostorBakerPort, ImpostorSourceDescriptor } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorTypes'

vi.mock('@/core/renderables/DetailedRingStreamingSystem/impostors/impostorResources', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/renderables/DetailedRingStreamingSystem/impostors/impostorResources')>()
  return { ...actual, checkImpostorCapabilities: () => ({ supported: true, samples: 4, reason: null }),
    createImpostorAtlas: vi.fn((_renderer, layout, count) => ({ layout, layerCount: count + 1, normalDepth: new DataArrayTexture(), surfaceCoverage: new DataArrayTexture(), dispose: vi.fn() })) }
})
vi.mock('@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary', () => ({
  getArchetypeGeometries: (_profile: string, count: number) => Array.from({ length: count }, () => new BoxGeometry())
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const source: ImpostorSourceDescriptor = { profile: 'stony', count: 2, detailL0: 1, detailNear: 2, realModels: ['itokawa'], sourceFingerprint: 'models', bakeVersion: 1 }
const shape = (): ShapeModelData => ({ positions: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) })
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

function setup() {
  const l0 = deferred<ShapeModelData | null>(), near = deferred<ShapeModelData | null>()
  const load = vi.fn((_name: string, tier: string) => tier === 'l0' ? l0.promise : near.promise)
  let remaining = 0
  const captures: { source: BufferGeometry; layer: number }[] = []
  const baker: ImpostorBakerPort = { begin: vi.fn((geometry, _atlas, layer) => { captures.push({ source: geometry, layer }); remaining = 3 }),
    step: vi.fn(() => --remaining <= 0 ? 'complete' : 'pending'), finish: vi.fn(() => ({ halfExtent: 1.05, boundRadius: 1 })), cancel: vi.fn(), dispose: vi.fn() }
  const renderer = { debug: { onShaderError: null }, getContext: () => ({ isContextLost: () => false, NO_ERROR: 0, getError: () => 0 }) } as unknown as WebGLRenderer
  const library = new AsteroidImpostorLibrary(renderer, asteroidImpostor.asteroidImpostor, { load } as unknown as ShapeModelStorage,
    undefined, { makeBaker: () => baker, yieldToUi: async () => {} })
  return { library, baker, load, l0, near, captures }
}

describe('Согласованные ревизии геометрии и атласа', () => {
  it('пара грузится сразу параллельно; initial не ждёт сеть, поздняя пара публикуется только после страницы', async () => {
    const { library, load, l0, near, captures } = setup(), lease = library.acquire(source, 0)
    expect(load.mock.calls).toEqual([['itokawa', 'l0'], ['itokawa', 'near']])
    await library.prepareInitial()
    const old = lease.current()
    expect(old.state).toBe('ready')
    l0.resolve(shape()); await flush()
    library.pumpFrame()
    expect(lease.current()).toBe(old)
    near.resolve(shape()); await flush()
    library.pumpFrame(); library.pumpFrame()
    expect(lease.current()).toBe(old)
    expect(captures.at(-1)?.layer).toBe(2)
    library.pumpFrame()
    expect(lease.current().revisions[1].version).toBe(1)
    expect(lease.current().slotLayers[1]).toBe(2)
    expect(old.slotLayers[1]).toBe(1)
    expect(lease.current().revisions[1].l0.getAttribute('position').count).toBe(3)
    library.clear()
  })

  it('пара до начала страницы заменяет pending, но не payload активного job', async () => {
    const { library, l0, near, captures } = setup(), lease = library.acquire(source, 0)
    library.pumpFrame()
    const activeSource = captures[0].source
    l0.resolve(shape()); near.resolve(shape()); await flush()
    await library.prepareInitial()
    expect(captures[0].source).toBe(activeSource)
    expect(captures).toHaveLength(2)
    expect(captures[1].source.getAttribute('position').count).toBe(3)
    expect(lease.current().revisions[1].version).toBe(1)
    library.clear()
  })

  it('поздняя пара не подменяет начатую заглушку; отдельная ревизия идёт в spare', async () => {
    const { library, l0, near, captures } = setup(), lease = library.acquire(source, 0)
    for (let i = 0; i < 4; i++) library.pumpFrame()
    const sourceBefore = captures[1].source
    l0.resolve(shape()); near.resolve(shape()); await flush()
    library.pumpFrame(); library.pumpFrame()
    expect(lease.current().revisions[1].version).toBe(0)
    expect(captures[1].source).toBe(sourceBefore)
    for (let i = 0; i < 3; i++) library.pumpFrame()
    expect(lease.current().revisions[1].version).toBe(1)
    expect(captures[2].layer).toBe(2)
    library.clear()
  })

  it.each(['copy', 'prepare'])('отказ %s сохраняет общую ревизию и spare для следующей попытки', async failure => {
    const { library, l0, near, captures, baker } = setup()
    const a = library.acquire(source, 0), b = library.acquire(source, 0)
    await library.prepareInitial()
    const old = a.current(), committed = vi.fn(), rolledBack = vi.fn()
    a.subscribe({ prepare: () => ({ commit: committed, dispose: rolledBack }) })
    const unsubscribe = b.subscribe({ prepare: () => { if (failure === 'prepare') throw new Error('consumer failed'); return { commit: vi.fn(), dispose: vi.fn() } } })
    l0.resolve(shape()); near.resolve(shape()); await flush()
    library.pumpFrame(); library.pumpFrame()
    if (failure === 'copy') vi.mocked(baker.step).mockImplementationOnce(() => { throw new Error('last copy failed') })
    library.pumpFrame()
    expect(a.current()).toBe(old); expect(b.current()).toBe(old)
    expect(committed).not.toHaveBeenCalled()
    if (failure === 'prepare') expect(rolledBack).toHaveBeenCalledTimes(1)
    unsubscribe()
    const late = library.acquire(source, 0)
    for (let i = 0; i < 3; i++) library.pumpFrame()
    expect(a.current().revisions[1].version).toBe(1)
    expect(late.current()).toBe(a.current())
    expect(captures.slice(-2).map(c => c.layer)).toEqual([2, 2])
    library.clear()
  })

  it('release одного клиента не отменяет общую пару; clear отсекает поздние ответы', async () => {
    const { library, l0, near, load } = setup()
    const a = library.acquire(source, 0), b = library.acquire(source, 0)
    a.release()
    expect(load).toHaveBeenCalledTimes(2)
    await library.prepareInitial()
    l0.resolve(shape()); near.resolve(shape()); await flush()
    for (let i = 0; i < 3; i++) library.pumpFrame()
    expect(b.current().revisions[1].version).toBe(1)
    library.clear()
    const late = setup(), lease = late.library.acquire(source, 0)
    late.library.clear(); late.l0.resolve(shape()); late.near.resolve(shape()); await flush()
    late.library.pumpFrame()
    expect(late.library.stats().libraries).toBe(0)
    expect(late.captures).toHaveLength(0)
    expect(lease.current().state).toBe('legacy')
  })
})
