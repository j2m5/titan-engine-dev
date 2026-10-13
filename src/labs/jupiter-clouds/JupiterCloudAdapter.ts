import { AtmosphereParameters, DensityProfileLayer } from '@takram/three-atmosphere'
import { CloudsEffect, type CloudsQualityPreset } from '@takram/three-clouds'
import { Ellipsoid } from '@takram/three-geospatial'
import { Color, PerspectiveCamera, Vector3 } from 'three'
import { RenderingObjects } from '@storage/database'
import type {
  AtmosphereConfig,
  DensityProfileLayer as TitanDensityLayer
} from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { adaptCloudDepth } from './planetDepth'

export const CLOUD_BASE_METRES = 10000
export const CLOUD_HEIGHT_METRES = 20000

/** Takram's radii are metres, but Bruneton's density profiles and coefficients remain in kilometres. */
export function createJupiterAtmosphere(): { config: AtmosphereConfig; atmosphere: AtmosphereParameters } {
  const row = RenderingObjects.find((entry) => entry.actorId === 49)
  if (!row) throw new Error('Jupiter atmosphere configuration is missing')
  const config = structuredClone(row.data) as unknown as AtmosphereConfig
  const profile = (layers: [TitanDensityLayer, TitanDensityLayer]): [DensityProfileLayer, DensityProfileLayer] =>
    layers.map(
      (layer) =>
        new DensityProfileLayer(layer.width, layer.expTerm, layer.expScale, layer.linearTerm, layer.constantTerm)
    ) as [DensityProfileLayer, DensityProfileLayer]
  const atmosphere = new AtmosphereParameters({
    bottomRadius: config.bottomRadius * 1000,
    topRadius: config.topRadius * 1000,
    solarIrradiance: new Vector3(...config.solarIrradiance),
    sunAngularRadius: config.sunAngularRadius,
    rayleighDensity: profile(config.rayleighDensity),
    rayleighScattering: new Vector3(...config.rayleighScattering),
    mieDensity: profile(config.mieDensity),
    mieScattering: new Vector3(...config.mieScattering),
    mieExtinction: new Vector3(...config.mieExtinction),
    miePhaseFunctionG: config.miePhaseFunctionG,
    absorptionDensity: profile(config.absorptionDensity),
    absorptionExtinction: new Vector3(...config.absorptionExtinction),
    groundAlbedo: new Color(...config.groundAlbedo),
    muSMin: config.muSMin
  })
  return { config, atmosphere }
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
  const clouds = new CloudsEffect(camera, undefined, atmosphere)
  clouds.ellipsoid = new Ellipsoid(atmosphere.bottomRadius, atmosphere.bottomRadius, atmosphere.bottomRadius)
  clouds.correctAltitude = false
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

  // Upstream 0.7.6 hardcodes WGS84 in copyCameraSettings, even with another ellipsoid.
  // Patch this single instance, after upstream updates matrices/depth/jitter. No global mutation.
  const material = clouds.cloudsPass.currentMaterial
  const copyCameraSettings = material.copyCameraSettings.bind(material)
  const position = new Vector3()
  material.copyCameraSettings = (activeCamera): void => {
    copyCameraSettings(activeCamera)
    activeCamera.getWorldPosition(position).applyMatrix4(clouds.worldToECEFMatrix)
    material.uniforms.cameraHeight.value = position.length() - atmosphere.bottomRadius
  }
  adaptCloudDepth(clouds)
  return clouds
}
