import type { AtmosphereParameters } from '@takram/three-atmosphere'
import type { CloudsEffect } from '@takram/three-clouds'
import type { PerspectiveCamera } from 'three'
import { RenderingObjects } from '@storage/database'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import {
  applyPlanetCloudLayer,
  createPlanetCloudEffect,
  toTakramAtmosphere
} from '@/core/clouds/takram/planetCloudAdapter'
import { adaptCloudDepth } from '@/labs/jupiter-clouds/planetDepth'
import { setCloudQuality } from '@/core/clouds/takram/cloudQuality'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'

export type EarthCloudQuality = 'low' | 'medium' | 'high'

export { prepareCloudTargets as prepareEarthCloudTargets } from '@/core/clouds/takram/prepareCloudTargets'

export function createEarthAtmosphere(): { config: AtmosphereConfig; atmosphere: AtmosphereParameters } {
  const row = RenderingObjects.find((entry) => entry.actorId === 47)
  if (!row) throw new Error('Earth atmosphere configuration is missing')
  const config = structuredClone(row.data) as unknown as AtmosphereConfig
  return { config, atmosphere: toTakramAtmosphere(config) }
}

export function setEarthCloudQuality(clouds: CloudsEffect, quality: EarthCloudQuality): void {
  setCloudQuality(clouds, 'terrestrial', quality)
}

export function createEarthClouds(camera: PerspectiveCamera, atmosphere: AtmosphereParameters): CloudsEffect {
  const clouds = createPlanetCloudEffect(camera, atmosphere)
  adaptCloudDepth(clouds)
  applyPlanetCloudLayer(clouds, createEarthCloudProfile())
  setEarthCloudQuality(clouds, 'medium')
  return clouds
}
