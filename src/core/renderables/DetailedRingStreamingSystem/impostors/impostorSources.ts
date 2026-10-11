import type { BufferGeometry } from 'three'
import { getArchetypeGeometries } from '../archetypes/ArchetypeLibrary'
import { SHAPE_MODEL_VERSION, shapeModelPath } from '../archetypes/ShapeModelFormat'
import type { ImpostorGeometryLease, ImpostorLayout, ImpostorRevision, ImpostorSourceDescriptor } from './impostorTypes'
import type { ImpostorBudget } from './impostorBudget'

export function impostorSourceFingerprint(names: readonly string[]): string {
  if (names.some(name => !/^[a-zA-Z0-9_-]+$/.test(name))) throw new Error('Неверное имя модели формы')
  return JSON.stringify([SHAPE_MODEL_VERSION, names.map(name => [shapeModelPath(name, 'l0'), shapeModelPath(name, 'near')])])
}

export function impostorSourceKey(source: ImpostorSourceDescriptor, layout: ImpostorLayout): string {
  return JSON.stringify([source.profile, source.count, source.detailL0, source.detailNear, source.realModels,
    source.sourceFingerprint, layout.gridSize, layout.frameSize, source.bakeVersion])
}

export function geometryBytes(geometry: BufferGeometry): number {
  const arrays = new Set(Object.values(geometry.attributes).map(attribute => attribute.array))
  if (geometry.index) arrays.add(geometry.index.array)
  return Array.from(arrays).reduce((sum, array) => sum + array.byteLength, 0)
}

export function geometryRadius(geometry: BufferGeometry): number {
  const positions = geometry.getAttribute('position')
  let radius = 0
  for (let i = 0; i < positions.count; i++) radius = Math.max(radius, Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i)))
  if (!(radius > 0) || !Number.isFinite(radius)) throw new Error('Вырожденная форма астероида')
  return radius
}

export function initialImpostorRevisions(source: ImpostorSourceDescriptor): ImpostorRevision[] {
  const l0 = getArchetypeGeometries(source.profile, source.count, source.detailL0, 1)
  const near = getArchetypeGeometries(source.profile, source.count, source.detailNear, 1)
  return l0.map((geometry, slot) => ({ slot, version: 0, l0: geometry, near: near[slot], boundRadius: geometryRadius(geometry) }))
}

interface PhysicalSource {
  l0: BufferGeometry
  near: BufferGeometry
  owner: object
  refs: number
  owned: boolean
  bytes: number
}

/** Физические копии принадлежат арендам, нормированные источники не меняются. */
export class ImpostorPhysicalSources {
  private readonly sources = new Map<string, PhysicalSource>()
  constructor(private readonly budget: ImpostorBudget, private readonly releaseGpu: (action: () => void) => void = action => action()) {}

  acquire(key: string, source: ImpostorSourceDescriptor, revision: ImpostorRevision, radius: number): ImpostorGeometryLease | null {
    if (!(radius > 0) || !Number.isFinite(radius)) throw new RangeError('Неверный размер астероида')
    const id = JSON.stringify([key, revision.slot, revision.version, radius])
    let entry = this.sources.get(id)
    if (!entry) {
      const owner = {}, owned = revision.version > 0
      const bytes = owned ? geometryBytes(revision.l0) + (revision.near === revision.l0 ? 0 : geometryBytes(revision.near)) : 0
      if (!this.budget.reserve(owner, bytes)) return null
      let l0: BufferGeometry | undefined, near: BufferGeometry | undefined
      try {
        l0 = owned ? revision.l0.clone().scale(radius, radius, radius)
          : getArchetypeGeometries(source.profile, source.count, source.detailL0, radius)[revision.slot]
        near = revision.l0 === revision.near ? l0 : owned ? revision.near.clone().scale(radius, radius, radius)
          : getArchetypeGeometries(source.profile, source.count, source.detailNear, radius)[revision.slot]
        entry = { l0, near, refs: 0, owned, owner, bytes }
        this.sources.set(id, entry)
        this.budget.commit(owner)
      } catch (error) {
        if (owned) this.releaseGpu(() => { l0?.dispose(); if (near !== l0) near?.dispose() })
        this.budget.release(owner)
        throw error
      }
    }
    const current = entry
    current.refs++
    let released = false
    return { l0: current.l0, near: current.near, release: () => {
      if (released) return
      released = true
      if (--current.refs === 0 && this.sources.get(id) === current) {
        this.sources.delete(id)
        this.free(current)
      }
    } }
  }

  private free(entry: PhysicalSource): void {
    if (entry.owned) this.releaseGpu(() => { entry.l0.dispose(); if (entry.near !== entry.l0) entry.near.dispose() })
    this.budget.release(entry.owner)
  }

  restoreBudget(): void {
    for (const entry of this.sources.values()) {
      if (!this.budget.reserve(entry.owner, entry.bytes)) throw new Error('Бюджет восстановления форм исчерпан')
      this.budget.commit(entry.owner)
    }
  }

  geometries(): BufferGeometry[] { return [...this.sources.values()].flatMap(entry => [entry.l0, entry.near]) }

  clear(): void {
    for (const entry of this.sources.values()) this.free(entry)
    this.sources.clear()
  }
}
