import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

/**
 * Поле `pool` приватно, а всё внутри него (geometryMeshes, geometryMaterial,
 * billboardMaterial) — публично. Каст один и заперт здесь, вместо `as any`
 * в каждом тесте: так униформы остаются типизированными.
 */
export const poolOf = (system: AsteroidRingSystem): InstancePool =>
  (system as unknown as { pool: InstancePool }).pool
