import { BoxGeometry, DataArrayTexture, type WebGLRenderer } from 'three'
import { asteroidImpostor } from '@/config/asteroidImpostor'
import { AsteroidImpostorLibrary } from '@/core/renderables/DetailedRingStreamingSystem/impostors/AsteroidImpostorLibrary'
import { AsteroidImpostorBinding } from '@/core/renderables/DetailedRingStreamingSystem/impostors/AsteroidImpostorBinding'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import type { ShapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
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

const source: ImpostorSourceDescriptor = { profile: 'stony', count: 1, detailL0: 1, detailNear: 2, realModels: ['itokawa'], sourceFingerprint: 'fallback', bakeVersion: 1 }
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
function setup(budgetMiB = 192) {
  const baker: ImpostorBakerPort = { begin: vi.fn(), step: vi.fn(() => 'complete' as const), finish: vi.fn(() => ({ halfExtent: 1.05, boundRadius: 1 })), cancel: vi.fn(), dispose: vi.fn() }
  const renderer = { debug: { onShaderError: null }, getContext: () => ({ isContextLost: () => false, NO_ERROR: 0, getError: () => 0 }) } as unknown as WebGLRenderer
  const load = vi.fn(async () => ({ positions: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) }))
  const library = new AsteroidImpostorLibrary(renderer, { ...asteroidImpostor.asteroidImpostor, budgetMiB },
    { load } as unknown as ShapeModelStorage, undefined, { makeBaker: () => baker, yieldToUi: async () => {} })
  const lease = library.acquire(source, 256)
  const pool = () => new InstancePool({ maxInstances: 2 }, { maxInstances: 2 }, { maxInstances: 2 }, [new BoxGeometry()], [new BoxGeometry()], 2,
    undefined, false, false, lease.allowsAtlas())
  return { library, lease, baker, pool }
}

describe('Работоспособный legacy после отказа импосторов', () => {
  it('загруженная до ленивого пула модель при нулевом бюджете оставляет процедурную форму', async () => {
    const s = setup(0)
    await tick(); await s.library.prepareInitial()
    const pool = s.pool(), binding = new AsteroidImpostorBinding(s.lease, pool, 1)
    expect(pool.geometryMeshes[0].geometry.getAttribute('position').count).toBe(24)
    expect(s.lease.current().revisions[0].version).toBe(0)
    expect(s.lease.current().state).toBe('legacy')
    expect(pool.billboardMaterial.fragmentShader).not.toContain('sampler2DArray')
    binding.dispose(); s.library.clear()
  })

  it.each(['warmup', 'bake'])('отказ %s публикует реальную модель вместе с legacy-программой', async failure => {
    const s = setup(), pool = s.pool(), binding = new AsteroidImpostorBinding(s.lease, pool, 1)
    await tick()
    if (failure === 'warmup') s.library.registerWarmup('broken', async () => { throw new Error('broken shader') }, () => {})
    else vi.mocked(s.baker.step).mockImplementationOnce(() => { throw new Error('broken framebuffer') })
    await s.library.prepareInitial()
    expect(s.lease.current().state).toBe('legacy')
    expect(s.lease.current().revisions[0].version).toBe(1)
    expect(pool.geometryMeshes[0].geometry.getAttribute('position').count).toBe(3)
    const legacy = new BillboardAsteroidMaterial()
    expect(pool.billboardMaterial.fragmentShader === legacy.fragmentShader).toBe(true)
    expect(pool.geometryMaterial.uniforms.uImpostorReady.value).toBe(0)
    legacy.dispose(); binding.dispose(); s.library.clear()
  })

  it('если новая физическая форма не подготовилась, fallback честно публикует прежнюю ревизию', async () => {
    const s = setup()
    let actual = s.lease.current()
    s.lease.subscribe({ prepare: next => {
      if (next.revisions[0].version > 0) throw new Error('cannot allocate model')
      return { commit: () => { actual = next }, dispose: () => {} }
    } })
    await tick()
    vi.mocked(s.baker.step).mockImplementationOnce(() => { throw new Error('failed bake') })
    await s.library.prepareInitial()
    expect(s.lease.current().revisions[0].version).toBe(0)
    expect(actual).toBe(s.lease.current())
    expect(actual.reason).toContain('failed bake')
    s.library.clear()
  })
})
