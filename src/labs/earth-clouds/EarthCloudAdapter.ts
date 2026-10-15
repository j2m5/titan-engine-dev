import type { AtmosphereParameters } from '@takram/three-atmosphere'
import type { CloudsEffect } from '@takram/three-clouds'
import type { PerspectiveCamera } from 'three'
import { RenderingObjects } from '@storage/database'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import {
  applyPlanetCloudLayer,
  createPlanetCloudEffect,
  toTakramAtmosphere
} from '@/labs/planet-clouds/planetCloudAdapter'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'

export type EarthCloudQuality = 'low' | 'medium' | 'high'

/** Takram 0.7.6 obtains the array texture handle before binding its target.
 * Initialize it first so the first current/resolve draw attaches every layer.
 */
export function prepareEarthCloudTargets(clouds: CloudsEffect): () => void {
  const restores = [clouds.shadowPass.currentPass, clouds.shadowPass.resolvePass].map((pass) => {
    const original = pass.render
    pass.render = function (...args: Parameters<typeof original>) {
      args[0].initRenderTarget(args[2])
      return original.apply(this, args)
    }
    return () => {
      pass.render = original
    }
  })
  return () => restores.forEach((restore) => restore())
}

export function createEarthAtmosphere(): { config: AtmosphereConfig; atmosphere: AtmosphereParameters } {
  const row = RenderingObjects.find((entry) => entry.actorId === 47)
  if (!row) throw new Error('Earth atmosphere configuration is missing')
  const config = structuredClone(row.data) as unknown as AtmosphereConfig
  return { config, atmosphere: toTakramAtmosphere(config) }
}

export function setEarthCloudQuality(clouds: CloudsEffect, quality: EarthCloudQuality): void {
  clouds.qualityPreset = quality
  const values = {
    low: { resolution: 0.65, minStep: 100, iterations: 256, sunSteps: 1 },
    medium: { resolution: 0.8, minStep: 50, iterations: 512, sunSteps: 2 },
    high: { resolution: 1, minStep: 25, iterations: 768, sunSteps: 4 }
  }[quality]
  clouds.resolutionScale = values.resolution
  Object.assign(clouds.clouds, {
    minStepSize: values.minStep,
    maxStepSize: 1000,
    maxIterationCount: values.iterations,
    maxRayDistance: 2000000,
    perspectiveStepScale: 1.000001,
    minDensity: 1e-7,
    minExtinction: 1e-7,
    minSecondaryStepSize: 100,
    maxIterationCountToSun: values.sunSteps
  })
  clouds.lightShafts = false
  clouds.haze = false
  clouds.turbulence = false
  // The inherited powder exponent is not calibrated for Earth's per-metre extinction.
  clouds.powderScale = 0
  clouds.shadow.maxFar = 200000
}

export function createEarthClouds(camera: PerspectiveCamera, atmosphere: AtmosphereParameters): CloudsEffect {
  const clouds = createPlanetCloudEffect(camera, atmosphere)
  const layer = createEarthCloudProfile().layers[0]
  applyPlanetCloudLayer(clouds, layer)
  setEarthCloudQuality(clouds, 'medium')
  return clouds
}
