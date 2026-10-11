import type { InstancePool } from '../InstancePool'
import { Mesh } from 'three'
import { IMPOSTOR_SLOT_CAPACITY } from './impostorLayout'
import { forgetImpostorContext, rememberImpostorContext } from './impostorContext'
import type { ImpostorConsumer, ImpostorGeometryLease, ImpostorLease, ImpostorRevision, ImpostorSnapshot, PreparedImpostorUpdate } from './impostorTypes'

interface BoundSource { revision: ImpostorRevision; geometry: ImpostorGeometryLease }

/** Привязка пула заимствует атлас, а физическими формами владеет через аренды. */
export class AsteroidImpostorBinding implements ImpostorConsumer {
  private readonly sources = new Map<number, BoundSource>()
  private readonly unsubscribe: () => void
  private disposed = false
  private appearanceReady = true
  private atlasReady = false

  constructor(private readonly lease: ImpostorLease, private readonly pool: InstancePool, private readonly radius: number) {
    rememberImpostorContext(pool.geometryMaterial, pool.billboardMaterial)
    this.rememberWrappers()
    if (pool.impostorAttributes) {
      const geometry = pool.geometryMaterial.uniforms, billboard = pool.billboardMaterial.uniforms
      for (const key of Object.keys(geometry)) if (billboard[key]) billboard[key] = geometry[key as keyof typeof geometry]
      billboard.uLightPosition = geometry.lightPosition
      billboard.uImpostorPhysicalSize.value = radius
    }
    let initial: PreparedImpostorUpdate
    try { initial = this.prepare(lease.current()) }
    catch (error) { initial = this.prepare(lease.useProceduralFallback(error instanceof Error ? error.message : String(error))) }
    initial.commit()
    initial.dispose()
    this.unsubscribe = lease.subscribe(this)
  }

  prepare(next: ImpostorSnapshot): PreparedImpostorUpdate {
    if (this.disposed) throw new Error('Привязка импостора завершена')
    if (next.state === 'ready') {
      if (!next.atlas || next.slotLayers.length > IMPOSTOR_SLOT_CAPACITY || next.slotLayers.length !== next.halfExtents.length) {
        throw new Error('Некорректная таблица импостора')
      }
      for (let i = 0; i < next.slotLayers.length; i++) {
        if (next.slotLayers[i] < 0 || next.slotLayers[i] >= next.atlas.layerCount || !(next.halfExtents[i] > 0)) throw new Error('Некорректный слой импостора')
      }
    }
    const changes: { slot: number; previous?: BoundSource; next: BoundSource; wrapper: PreparedImpostorUpdate }[] = []
    try {
      for (const revision of next.revisions) {
        if (revision.slot < 0 || revision.slot >= this.pool.geometryStreamCount) throw new Error('Архетип вне пула')
        const previous = this.sources.get(revision.slot)
        if (previous?.revision.version === revision.version) continue
        const geometry = this.lease.acquireGeometry(revision, this.radius)
        if (!geometry) throw new Error('Бюджет физической формы исчерпан')
        try {
          changes.push({ slot: revision.slot, previous, next: { revision, geometry },
            wrapper: this.pool.prepareArchetypeGeometry(revision.slot, geometry.l0, geometry.near) })
        } catch (error) { geometry.release(); throw error }
      }
    } catch (error) {
      for (const change of changes) { change.wrapper.dispose(); change.next.geometry.release() }
      throw error
    }
    let committed = false, disposed = false
    return {
      commit: () => {
        if (committed || disposed) return
        for (const change of changes) {
          change.wrapper.commit()
          this.sources.set(change.slot, change.next)
        }
        this.rememberWrappers()
        this.pool.billboardMaterial.setImpostorSnapshot(next)
        this.atlasReady = this.pool.impostorAttributes && next.state === 'ready'
        this.pool.geometryMaterial.uniforms.uImpostorReady.value = this.atlasReady && this.appearanceReady ? 1 : 0
        committed = true
      },
      dispose: () => {
        if (disposed) return
        disposed = true
        for (const change of changes) {
          change.wrapper.dispose()
          if (committed) change.previous?.geometry.release()
          else change.next.geometry.release()
        }
      }
    }
  }

  setAppearanceReady(ready: boolean): void {
    if (this.disposed) return
    this.appearanceReady = ready
    this.pool.geometryMaterial.uniforms.uImpostorReady.value = this.atlasReady && ready ? 1 : 0
  }

  invalidateGpu(): void {
    forgetImpostorContext(this.pool.geometryMaterial, this.pool.billboardMaterial)
    for (const object of this.pool.getRenderObjects()) if (object instanceof Mesh) forgetImpostorContext(object, object.geometry)
  }

  rejectRestoration(): void { this.pool.dropImpostorAttributes() }

  private rememberWrappers(): void {
    for (const object of this.pool.getRenderObjects()) if (object instanceof Mesh) rememberImpostorContext(object, object.geometry)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    for (const source of this.sources.values()) source.geometry.release()
    this.sources.clear()
  }
}
