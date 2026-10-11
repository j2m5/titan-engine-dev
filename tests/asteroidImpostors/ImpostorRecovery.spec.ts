import { BoxGeometry, DataArrayTexture, type WebGLRenderer } from 'three'
import { asteroidImpostor } from '@/config/asteroidImpostor'
import { AsteroidImpostorLibrary } from '@/core/renderables/DetailedRingStreamingSystem/impostors/AsteroidImpostorLibrary'
import { AsteroidImpostorBinding } from '@/core/renderables/DetailedRingStreamingSystem/impostors/AsteroidImpostorBinding'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import type { ShapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
import type { ShapeModelData } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'
import type { ImpostorBakerPort, ImpostorSourceDescriptor } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorTypes'

vi.mock('@/core/renderables/DetailedRingStreamingSystem/impostors/impostorResources', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/renderables/DetailedRingStreamingSystem/impostors/impostorResources')>()
  return { ...actual, checkImpostorCapabilities: () => ({ supported: true, samples: 4, reason: null }),
    createImpostorAtlas: vi.fn((_renderer, layout, count) => ({ layout, layerCount: count + 1,
      normalDepth: new DataArrayTexture(), surfaceCoverage: new DataArrayTexture(), dispose: vi.fn() })) }
})
vi.mock('@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary', () => ({
  getArchetypeGeometries: (_profile: string, count: number) => Array.from({ length: count }, () => new BoxGeometry())
}))

const source: ImpostorSourceDescriptor = { profile: 'stony', count: 2, detailL0: 1, detailNear: 2, realModels: ['itokawa'], sourceFingerprint: 'restore', bakeVersion: 1 }
const shape = (): ShapeModelData => ({ positions: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) })
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
function setup() {
  let lost = false
  const domElement = document.createElement('canvas'), listeners = vi.spyOn(domElement, 'addEventListener')
  const baker: ImpostorBakerPort = { begin: vi.fn(), step: vi.fn(() => 'complete' as const), finish: vi.fn(() => ({ halfExtent: 1.05, boundRadius: 1 })), cancel: vi.fn(), dispose: vi.fn() }
  const makeBaker = vi.fn(() => baker), load = vi.fn(async () => shape())
  const renderer = { domElement, debug: { onShaderError: null },
    getContext: () => ({ isContextLost: () => lost, NO_ERROR: 0, getError: () => 0 }) } as unknown as WebGLRenderer
  const library = new AsteroidImpostorLibrary(renderer, asteroidImpostor.asteroidImpostor,
    { load } as unknown as ShapeModelStorage, undefined, { makeBaker, yieldToUi: async () => {} })
  return { library, baker, makeBaker, load, listeners,
    lose: () => { lost = true; domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true })) },
    restore: () => { lost = false; domElement.dispatchEvent(new Event('webglcontextrestored')) } }
}

describe('Восстановление импосторов', () => {
  it('при переполнении после lost лишняя аренда восстанавливается без atlas-атрибутов и без исключения', async () => {
    const s = setup()
    s.lose(); s.library.clear()
    const accepted = s.library.acquire(source, 150 * 1024 * 1024)
    const refused = s.library.acquire(source, 150 * 1024 * 1024)
    const pool = new InstancePool({ maxInstances: 4 }, { maxInstances: 4 }, { maxInstances: 4 },
      [new BoxGeometry(), new BoxGeometry()], [new BoxGeometry(), new BoxGeometry()], 2,
      undefined, false, false, refused.allowsAtlas())
    const binding = new AsteroidImpostorBinding(refused, pool, 1)
    s.restore(); await s.library.prepareInitial()
    expect(accepted.current().state).toBe('ready')
    expect(refused.allowsAtlas()).toBe(false)
    expect(refused.current().state).toBe('legacy')
    expect(pool.billboardMesh.geometry.getAttribute('instanceArchetype')).toBeUndefined()
    expect(pool.impostorAttributes).toBe(false)
    expect(pool.billboardMaterial.fragmentShader).not.toContain('sampler2DArray')
    expect(s.library.stats().peakBytes).toBeLessThanOrEqual(192 * 1024 * 1024)
    binding.dispose(); s.library.clear()
  })

  it.each(['new scene', 'shared library'])('аренда во время lost (%s) получает рабочий атлас после restore', async mode => {
    const s = setup()
    s.library.acquire(source, 128)
    await s.library.prepareInitial()
    s.lose()
    if (mode === 'new scene') s.library.clear()
    const lease = s.library.acquire(source, 256)
    const pool = new InstancePool({ maxInstances: 4 }, { maxInstances: 4 }, { maxInstances: 4 },
      [new BoxGeometry(), new BoxGeometry()], [new BoxGeometry(), new BoxGeometry()], 2,
      undefined, false, false, lease.allowsAtlas())
    const binding = new AsteroidImpostorBinding(lease, pool, 2)
    expect(pool.billboardMesh.geometry.getAttribute('instanceArchetype')).toBeDefined()
    expect(lease.current().state).toBe('legacy')
    s.restore(); await s.library.prepareInitial()
    expect(lease.current().state).toBe('ready')
    expect(lease.current().reason).toBeNull()
    expect(pool.geometryMaterial.uniforms.uImpostorReady.value).toBe(1)
    expect(pool.billboardMaterial.fragmentShader).toContain('sampler2DArray')
    binding.dispose(); s.library.clear()
  })

  it('lost немедленно включает legacy, не удаляет GPU; restore запекает прежнюю CPU-форму без fetch', async () => {
    const s = setup(), lease = s.library.acquire(source, 1024)
    await tick(); await s.library.prepareInitial()
    const previous = lease.current(), commits: string[] = []
    expect(previous.revisions[1].version).toBe(1)
    lease.subscribe({ prepare: next => ({ commit: () => { commits.push(next.state) }, dispose: vi.fn() }) })
    s.lose()
    expect(lease.current().state).toBe('legacy')
    expect(lease.current().revisions).toEqual(previous.revisions)
    expect(commits).toEqual(['legacy'])
    expect(previous.atlas!.dispose).not.toHaveBeenCalled()
    expect(s.baker.dispose).not.toHaveBeenCalled()
    const calls = vi.mocked(s.baker.step).mock.calls.length
    s.library.pumpFrame(); await s.library.prepareInitial()
    expect(s.baker.step).toHaveBeenCalledTimes(calls)
    expect(s.library.stats().allocatedBytes + s.library.stats().reservedBytes).toBe(0)
    s.restore(); await s.library.prepareInitial()
    expect(lease.current().state).toBe('ready')
    expect(lease.current().atlas).not.toBe(previous.atlas)
    expect(lease.current().revisions[1].l0).toBe(previous.revisions[1].l0)
    expect(s.load).toHaveBeenCalledTimes(2)
    expect(previous.atlas!.dispose).toHaveBeenCalledTimes(1)
    expect(s.makeBaker).toHaveBeenCalledTimes(2)
    s.library.clear()
  })

  it.each(['capture', 'copy'])('отмена в %s не запускает cleanup или работу в lost, clear запрещает воскрешение', async () => {
    const s = setup(), lease = s.library.acquire(source, 128)
    vi.mocked(s.baker.step).mockReturnValue('pending')
    s.library.pumpFrame(); s.lose()
    const calls = vi.mocked(s.baker.step).mock.calls.length
    s.library.pumpFrame(); s.library.clear(); lease.release(); s.library.clear()
    expect(s.baker.cancel).not.toHaveBeenCalled()
    expect(s.baker.dispose).not.toHaveBeenCalled()
    expect(s.baker.step).toHaveBeenCalledTimes(calls)
    s.restore(); await s.library.prepareInitial()
    expect(s.makeBaker).toHaveBeenCalledTimes(1)
    expect(s.baker.dispose).toHaveBeenCalledTimes(1)
    expect(s.library.stats()).toMatchObject({ libraries: 0, readySlots: 0, queuedJobs: 0, allocatedBytes: 0, reservedBytes: 0 })
  })

  it('release в lost оставляет восстановление пустым; слушатели не копятся при смене сцен', async () => {
    const s = setup(), lease = s.library.acquire(source, 0)
    await s.library.prepareInitial(); s.lose(); lease.release(); s.restore(); await s.library.prepareInitial()
    expect(s.library.stats().libraries).toBe(0)
    expect(s.makeBaker).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) { s.library.acquire(source, 0); await s.library.prepareInitial(); s.library.clear() }
    expect(s.listeners.mock.calls.filter(c => c[0] === 'webglcontextlost')).toHaveLength(1)
    expect(s.listeners.mock.calls.filter(c => c[0] === 'webglcontextrestored')).toHaveLength(1)
  })

  it('clear во время async warmup не коммитит освобождённый резерв', async () => {
    const s = setup()
    let complete!: () => void
    const pending = new Promise<void>(resolve => { complete = resolve }), release = vi.fn()
    s.library.acquire(source, 0)
    s.library.registerWarmup('pending', () => pending, release)
    const initial = s.library.prepareInitial(); await tick()
    s.library.clear(); complete(); await initial
    expect(s.library.stats().fallbackReasons).toEqual([])
    expect(s.library.stats().allocatedBytes + s.library.stats().reservedBytes).toBe(0)
    expect(release).toHaveBeenCalledTimes(1)
  })
})
