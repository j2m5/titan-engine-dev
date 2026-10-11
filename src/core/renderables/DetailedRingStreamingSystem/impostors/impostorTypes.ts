import type { BufferGeometry, DataArrayTexture, Texture, Vector3 } from 'three'
import type { AsteroidProfileName } from '../AsteroidProfiles'
import type { ImpostorLayout } from './impostorLayout'

export type { ImpostorLayout } from './impostorLayout'

export interface ImpostorSourceDescriptor {
  profile: AsteroidProfileName
  count: number
  detailL0: number
  detailNear: number
  realModels: readonly string[]
  sourceFingerprint: string
  bakeVersion: number
}

export interface ImpostorRevision {
  slot: number
  version: number
  l0: BufferGeometry
  near: BufferGeometry
  boundRadius: number
}

export interface ImpostorAtlas {
  invalidateGpu?(): void
  normalDepth: DataArrayTexture
  surfaceCoverage: DataArrayTexture
  layout: ImpostorLayout
  layerCount: number
  dispose(): void
}

export interface ImpostorSnapshot {
  generation: number
  state: 'legacy' | 'ready'
  atlas: ImpostorAtlas | null
  slotLayers: Int32Array
  halfExtents: Float32Array
  revisions: readonly ImpostorRevision[]
  reason: string | null
}

export interface PreparedImpostorUpdate {
  commit(): void
  dispose(): void
}

export interface ImpostorConsumer {
  invalidateGpu?(): void
  rejectRestoration?(): void
  prepare(next: ImpostorSnapshot): PreparedImpostorUpdate
}

export interface AsteroidSurfaceAverageValues {
  diffuse: Vector3
  arm: Vector3
}

export interface ImpostorGeometryLease {
  l0: BufferGeometry
  near: BufferGeometry
  release(): void
}

export interface ImpostorLease {
  current(): ImpostorSnapshot
  allowsAtlas(): boolean
  useProceduralFallback(reason: string): ImpostorSnapshot
  acquireGeometry(revision: ImpostorRevision, radius: number): ImpostorGeometryLease | null
  prepareSurfaceAverages(diffuse: Texture, arm: Texture): Promise<AsteroidSurfaceAverageValues>
  subscribe(consumer: ImpostorConsumer): () => void
  release(): void
}

export interface ImpostorBakerPort {
  invalidateGpu?(): void
  begin(source: BufferGeometry, atlas: ImpostorAtlas, layer: number): void
  step(maxViews: number, maxCpuMs: number): 'pending' | 'complete'
  finish(): { boundRadius: number; halfExtent: number }
  cancel(): void
  dispose(): void
}
