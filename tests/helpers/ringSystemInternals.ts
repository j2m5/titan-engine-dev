import { AsteroidRingSystem, AsteroidRingConfig } from '@/core/renderables/DetailedRingStreamingSystem'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import { SectorManager, LODThresholds } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { AsteroidGenerator, GeneratorConfig } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { SectorGrid } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'
import { RadialDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/RadialDensityProfile'

/**
 * Приватные поля системы, к которым обращаются тесты. Типы взяты с объявлений
 * в AsteroidRingSystem — один каст на все поля вместо одного на каждое обращение.
 */
type RingSystemInternals = {
  pool: InstancePool
  manager: SectorManager
  generator: AsteroidGenerator
  sectorGrid: SectorGrid
  dustVolume: RingDustVolume | null
  config: AsteroidRingConfig
  densityProfileReady: boolean
  __tryBuildDensityProfile(): void
}

export const internalsOf = (system: AsteroidRingSystem): RingSystemInternals => system as unknown as RingSystemInternals

/** Поле `pool` приватно, а всё внутри него — публично. Тонкая обёртка над internalsOf,
 *  форма уже разошлась по сайтам вызова. */
export const poolOf = (system: AsteroidRingSystem): InstancePool => internalsOf(system).pool

/** Поле `thresholds` приватно в SectorManager — отдельный аксессор, не часть RingSystemInternals. */
export const thresholdsOf = (manager: SectorManager): LODThresholds =>
  (manager as unknown as { thresholds: LODThresholds }).thresholds

/**
 * Поле `config` приватно в AsteroidGenerator — свой конфиг (TU), отдельный от
 * AsteroidRingConfig системы (км) на internalsOf(system).config.
 */
export const generatorConfigOf = (generator: AsteroidGenerator): GeneratorConfig =>
  (generator as unknown as { config: GeneratorConfig }).config

/** Поле `densityProfile` приватно и в SectorGrid, и в AsteroidGenerator — одна форма на оба. */
export const densityProfileOf = (owner: SectorGrid | AsteroidGenerator): RadialDensityProfile | null =>
  (owner as unknown as { densityProfile: RadialDensityProfile | null }).densityProfile
