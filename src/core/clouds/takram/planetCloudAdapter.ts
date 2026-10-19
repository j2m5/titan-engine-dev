import { AtmosphereParameters, DensityProfileLayer } from '@takram/three-atmosphere'
import { CloudsEffect } from '@takram/three-clouds'
import { Ellipsoid } from '@takram/three-geospatial'
import { Color, PerspectiveCamera, Vector3 } from 'three'
import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'
import type {
  AtmosphereConfig,
  DensityProfileLayer as TitanDensityLayer
} from '@/core/renderables/Atmosphere/AtmosphereConfig'

/** Scene radii are metres; Bruneton coefficients and density profiles remain in kilometres. */
export function toTakramAtmosphere(config: AtmosphereConfig): AtmosphereParameters {
  const profile = (layers: [TitanDensityLayer, TitanDensityLayer]): [DensityProfileLayer, DensityProfileLayer] =>
    layers.map(
      (layer) =>
        new DensityProfileLayer(layer.width, layer.expTerm, layer.expScale, layer.linearTerm, layer.constantTerm)
    ) as [DensityProfileLayer, DensityProfileLayer]
  return new AtmosphereParameters({
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
}

export function applyPlanetCloudLayer(clouds: CloudsEffect, config: EnabledCloudConfig): void {
  const layer = config.layers[0]
  clouds.cloudLayers.reset().set([
    {
      channel: 'r',
      altitude: layer.baseAltitudeMeters,
      height: layer.thicknessMeters,
      densityScale: 1,
      shapeAmount: 1,
      shapeDetailAmount: layer.detail.erosionStrength,
      shapeAlteringBias: layer.detail.verticalProfileBias ?? 0.35,
      shadow: layer.castsShadow
    }
  ])
  clouds.scatteringCoefficient = layer.extinctionPerMeter
  clouds.absorptionCoefficient = 0
}

export function createPlanetCloudEffect(camera: PerspectiveCamera, atmosphere: AtmosphereParameters): CloudsEffect {
  const clouds = new CloudsEffect(camera, undefined, atmosphere)
  clouds.ellipsoid = new Ellipsoid(atmosphere.bottomRadius, atmosphere.bottomRadius, atmosphere.bottomRadius)
  clouds.correctAltitude = false
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
  return clouds
}
