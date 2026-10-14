import type { AtmosphereParameters } from '@takram/three-atmosphere'
import type { CloudsEffect, CloudsQualityPreset } from '@takram/three-clouds'
import { PerspectiveCamera, Texture, RepeatWrapping, ClampToEdgeWrapping } from 'three'
import { RenderingObjects } from '@storage/database'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { createPlanetCloudEffect, toTakramAtmosphere } from '@/labs/planet-clouds/planetCloudAdapter'
import { createJupiterCloudProfile } from './jupiterCloudProfile'

const defaultLayer = createJupiterCloudProfile().layers[0]
export const CLOUD_BASE_METRES = defaultLayer.baseAltitudeMeters
export const CLOUD_HEIGHT_METRES = defaultLayer.thicknessMeters

/** An owned view uses the same canonical UV transform as the appearance shaders. */
export function createCloudSurfaceView(source: Texture, longitudeOffsetRadians: number): Texture {
  const view = source.clone()
  view.offset.set(longitudeOffsetRadians / (2 * Math.PI), 0)
  view.repeat.set(1, 1)
  view.center.set(0, 0)
  view.rotation = 0
  view.wrapS = RepeatWrapping
  view.wrapT = ClampToEdgeWrapping
  view.updateMatrix()
  view.needsUpdate = true
  return view
}

/** Takram's radii are metres, but Bruneton's density profiles and coefficients remain in kilometres. */
export function createJupiterAtmosphere(): { config: AtmosphereConfig; atmosphere: AtmosphereParameters } {
  const row = RenderingObjects.find((entry) => entry.actorId === 49)
  if (!row) throw new Error('Jupiter atmosphere configuration is missing')
  const config = structuredClone(row.data) as unknown as AtmosphereConfig
  return { config, atmosphere: toTakramAtmosphere(config) }
}

export function setJupiterCloudQuality(clouds: CloudsEffect, quality: CloudsQualityPreset): void {
  clouds.qualityPreset = quality
  // The terrestrial defaults cap the march at 100–200 km. Orbit is much farther away.
  clouds.clouds.maxRayDistance = 5e8
  clouds.clouds.maxIterationCount = quality === 'low' ? 128 : quality === 'medium' ? 256 : 384
  clouds.clouds.minStepSize = quality === 'low' ? 800 : quality === 'medium' ? 400 : 200
  clouds.resolutionScale = quality === 'low' ? 0.65 : quality === 'medium' ? 0.8 : 1
  clouds.clouds.maxStepSize = 4000
  // Upstream grows the FIRST step with camera-to-shell distance (90,000 km in the orbit preset).
  // Its terrestrial 1.01 factor skips our entire 20 km shell before taking the first sample.
  clouds.clouds.perspectiveStepScale = 1.000001
  clouds.clouds.minDensity = 1e-7
  clouds.clouds.minExtinction = 1e-7
  clouds.clouds.minSecondaryStepSize = 1000
  clouds.clouds.maxIterationCountToSun = quality === 'high' ? 4 : 2
  clouds.lightShafts = false
  clouds.haze = false
  clouds.turbulence = false
  clouds.shadow.maxFar = 200000
}

export function createJupiterClouds(camera: PerspectiveCamera, atmosphere: AtmosphereParameters): CloudsEffect {
  const clouds = createPlanetCloudEffect(camera, atmosphere)
  clouds.cloudLayers.reset().set([
    {
      channel: 'r',
      altitude: CLOUD_BASE_METRES,
      height: CLOUD_HEIGHT_METRES,
      densityScale: 0.0008,
      shapeAmount: 1,
      shapeDetailAmount: 0.4,
      shadow: true
    }
  ])
  clouds.coverage = 0.45
  clouds.shapeRepeat.setScalar(1 / 120000)
  clouds.shapeDetailRepeat.setScalar(1 / 12000)
  setJupiterCloudQuality(clouds, 'medium')

  return clouds
}
