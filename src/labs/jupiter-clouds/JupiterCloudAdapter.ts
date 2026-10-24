import type { AtmosphereParameters } from '@takram/three-atmosphere'
import type { CloudsEffect, CloudsQualityPreset } from '@takram/three-clouds'
import { PerspectiveCamera, Texture, RepeatWrapping, ClampToEdgeWrapping } from 'three'
import { RenderingObjects } from '@storage/database'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { createPlanetCloudEffect, toTakramAtmosphere } from '@/core/clouds/takram/planetCloudAdapter'
import { adaptCloudDepth } from '@/labs/jupiter-clouds/planetDepth'
import { createCloudTextureView } from '@/core/clouds/appearance/cloudImagePixels'
import { setCloudQuality } from '@/core/clouds/takram/cloudQuality'
import { createJupiterCloudProfile } from '@/core/clouds/profiles/jupiterCloudProfile'

const defaultLayer = createJupiterCloudProfile().layers[0]
export const CLOUD_BASE_METRES = defaultLayer.baseAltitudeMeters
export const CLOUD_HEIGHT_METRES = defaultLayer.thicknessMeters

/** An owned view uses the same canonical UV transform as the appearance shaders. */
export function createCloudSurfaceView(source: Texture, longitudeOffsetRadians: number): Texture {
  const view = createCloudTextureView(source)
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
  if (quality === 'ultra') throw new RangeError('Unsupported Jupiter cloud quality: ultra')
  setCloudQuality(clouds, 'giant', quality)
}

export function createJupiterClouds(camera: PerspectiveCamera, atmosphere: AtmosphereParameters): CloudsEffect {
  const clouds = createPlanetCloudEffect(camera, atmosphere)
  adaptCloudDepth(clouds)
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
