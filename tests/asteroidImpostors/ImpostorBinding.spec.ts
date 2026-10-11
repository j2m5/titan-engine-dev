import { BoxGeometry, DataArrayTexture, Vector3 } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import { AsteroidImpostorBinding } from '@/core/renderables/DetailedRingStreamingSystem/impostors/AsteroidImpostorBinding'
import { ImpostorBudget } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorBudget'
import { ImpostorPhysicalSources } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorSources'
import { createImpostorLayout } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'
import type { ImpostorLease, ImpostorSnapshot, ImpostorSourceDescriptor } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorTypes'

function setup() {
  const source: ImpostorSourceDescriptor = { profile: 'stony', count: 1, detailL0: 1, detailNear: 2, realModels: [], sourceFingerprint: 'test', bakeVersion: 1 }
  const budget = new ImpostorBudget(1024 * 1024), physical = new ImpostorPhysicalSources(budget)
  const revision = { slot: 0, version: 1, l0: new BoxGeometry(1, 2, 3), near: new BoxGeometry(1, 2, 3, 2, 2, 2), boundRadius: 2 }
  const atlas = { layout: createImpostorLayout(8, 64), layerCount: 2, normalDepth: new DataArrayTexture(), surfaceCoverage: new DataArrayTexture(), dispose: vi.fn() }
  const snapshot: ImpostorSnapshot = { generation: 1, state: 'ready', atlas, slotLayers: new Int32Array([0]), halfExtents: new Float32Array([2.1]), revisions: [revision], reason: null }
  const unsubscribe = vi.fn(), lease: ImpostorLease = { current: () => snapshot, allowsAtlas: () => true,
    useProceduralFallback: () => ({ ...snapshot, state: 'legacy', atlas: null, revisions: [], reason: 'fallback' }),
    acquireGeometry: (rev, radius) => physical.acquire('test', source, rev, radius),
    prepareSurfaceAverages: async () => ({ diffuse: new Vector3(1, 1, 1), arm: new Vector3(1, 1, 0) }), subscribe: vi.fn(() => unsubscribe), release: vi.fn() }
  const pool = () => new InstancePool({ maxInstances: 10 }, { maxInstances: 10 }, { maxInstances: 10 }, [new BoxGeometry()], [new BoxGeometry()], 2.5, undefined, false, false, true)
  return { budget, physical, revision, atlas, snapshot, lease, unsubscribe, pool }
}

describe('Привязка общей ревизии к пулу', () => {
  it('поздний пул сразу получает готовую ревизию, общие uniform и физические источники', () => {
    const { lease, pool, revision, budget, atlas } = setup(), a = pool(), b = pool()
    const bindingA = new AsteroidImpostorBinding(lease, a, 3), bytes = budget.snapshot().allocatedBytes
    const bindingB = new AsteroidImpostorBinding(lease, b, 3)
    expect(a.geometryMeshes[0].geometry.getAttribute('position')).toBe(b.geometryMeshes[0].geometry.getAttribute('position'))
    expect(budget.snapshot().allocatedBytes).toBe(bytes)
    expect(revision.l0.getAttribute('position').getX(0)).toBe(0.5)
    expect(a.geometryMeshes[0].geometry.getAttribute('position').getX(0)).toBe(1.5)
    expect(a.billboardMaterial.uniforms.uImpostorReady).toBe(a.geometryMaterial.uniforms.uImpostorReady)
    expect(a.billboardMaterial.uniforms.uLightPosition).toBe(a.geometryMaterial.uniforms.lightPosition)
    expect(a.billboardMaterial.uniforms.uSpinTime).toBe(a.geometryMaterial.uniforms.uSpinTime)
    expect(a.billboardMaterial.uniforms.uImpostorPhysicalSize.value).toBe(3)
    bindingA.dispose(); bindingA.dispose()
    expect(budget.snapshot().allocatedBytes).toBe(bytes)
    bindingB.dispose()
    expect(budget.snapshot().allocatedBytes).toBe(0)
    expect(atlas.dispose).not.toHaveBeenCalled()
    expect(lease.release).not.toHaveBeenCalled()
  })

  it('prepare не меняет живые ссылки; rollback освобождает только новые копии', () => {
    const { lease, pool, snapshot, budget, revision } = setup(), p = pool(), binding = new AsteroidImpostorBinding(lease, p, 2)
    const old = p.geometryMeshes[0].geometry, bytes = budget.snapshot().allocatedBytes
    const next = { ...snapshot, slotLayers: new Int32Array([1]), revisions: [{ ...revision, version: 2, l0: new BoxGeometry(4, 1, 1) }] }
    const prepared = binding.prepare(next)
    expect(p.geometryMeshes[0].geometry).toBe(old)
    expect(p.billboardMaterial.uniforms.uImpostorSlotLayers.value[0]).toBe(0)
    expect(budget.snapshot().allocatedBytes).toBeGreaterThan(bytes)
    prepared.dispose()
    expect(budget.snapshot().allocatedBytes).toBe(bytes)
    const update = binding.prepare(next); update.commit(); update.dispose()
    expect(p.billboardMaterial.uniforms.uImpostorSlotLayers.value[0]).toBe(1)
    expect(p.geometryMeshes[0].geometry.getAttribute('position').getX(0)).toBe(4)
    const fallback = binding.prepare({ ...next, state: 'legacy', atlas: null }); fallback.commit(); fallback.dispose()
    expect(p.geometryMaterial.uniforms.uImpostorReady.value).toBe(0)
    expect(p.geometryMeshes[0].geometry.getAttribute('position').getX(0)).toBe(4)
    binding.dispose()
  })

  it('нехватка бюджета новой геометрии оставляет прежние буферы и слой', () => {
    const { lease, pool, snapshot, revision, budget } = setup(), p = pool(), binding = new AsteroidImpostorBinding(lease, p, 1)
    const before = p.geometryMeshes[0].geometry
    const blocker = {}; expect(budget.reserve(blocker, budget.limitBytes - budget.snapshot().allocatedBytes)).toBe(true)
    expect(() => binding.prepare({ ...snapshot, revisions: [{ ...revision, version: 2 }] })).toThrow('Бюджет')
    expect(p.geometryMeshes[0].geometry).toBe(before)
    expect(p.billboardMaterial.uniforms.uImpostorSlotLayers.value[0]).toBe(0)
    binding.dispose(); budget.release(blocker)
  })
})
