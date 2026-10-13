import type { CloudsEffect } from '@takram/three-clouds'
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'
import type { CloudAppearanceTextures } from './cloudAppearanceTextures'
import { adaptCloudAppearanceShader } from './cloudAppearanceShader'

export function assertCloudAppearanceSupport(config: EnabledCloudConfig): void {
  if (
    config.farAppearance !== 'base-texture' ||
    config.layers.length !== 1 ||
    config.layers[0].pattern.kind !== 'appearance'
  )
    throw new Error('Unsupported cloud appearance: requires one appearance layer and base-texture far appearance')
}

export type CloudAppearanceBinding = { setPlanetRotation(rotation: Quaternion): void; dispose(): void }

export function bindCloudAppearance(
  clouds: CloudsEffect,
  config: EnabledCloudConfig,
  textures: CloudAppearanceTextures
): CloudAppearanceBinding {
  assertCloudAppearanceSupport(config)
  const materials = [clouds.cloudsPass.currentMaterial, clouds.shadowPass.currentMaterial]
  const originals = materials.map((material) => ({
    shader: material.fragmentShader,
    uniforms: { ...material.uniforms }
  }))
  // Validate both passes before changing either pass or any effect parameter.
  const shaders = originals.map((original, index) =>
    adaptCloudAppearanceShader(original.shader, index === 0 ? 'cloud' : 'shadow')
  )
  const layer = config.layers[0]
  const ecefToPlanet = new Matrix3()
  const shared = {
    cloudECEFToPlanet: { value: ecefToPlanet },
    cloudLongitudeOffset: { value: config.mapping.longitudeOffsetRadians },
    cloudUseColorMap: { value: textures.color !== null },
    cloudColorTexture: { value: textures.color ?? textures.weather },
    cloudConstantColor: { value: new Vector3(...textures.constantColorLinear) },
    cloudColorStrength: { value: textures.colorStrength },
    cloudColorMipBias: {
      value: textures.color ? Math.log2(textures.color.image.width / textures.weather.image.width) : 0
    }
  }
  const previous = {
    layers: clouds.cloudLayers.clone(),
    weather: clouds.localWeatherTexture,
    scattering: clouds.scatteringCoefficient,
    absorption: clouds.absorptionCoefficient,
    coverage: clouds.coverage,
    shapeRepeat: clouds.shapeRepeat.clone(),
    detailRepeat: clouds.shapeDetailRepeat.clone(),
    shapeOffset: clouds.shapeOffset.clone(),
    detailOffset: clouds.shapeDetailOffset.clone(),
    weatherRepeat: clouds.localWeatherRepeat.clone(),
    weatherOffset: clouds.localWeatherOffset.clone()
  }
  materials.forEach((material, i) => {
    material.fragmentShader = shaders[i]
    Object.assign(material.uniforms, shared)
    material.needsUpdate = true
  })
  clouds.cloudLayers
    .reset()
    .set([
      {
        channel: 'r',
        altitude: layer.baseAltitudeMeters,
        height: layer.thicknessMeters,
        densityScale: 1,
        shapeAmount: 1,
        shapeDetailAmount: layer.detail.erosionStrength,
        shadow: layer.castsShadow
      }
    ])
  clouds.localWeatherTexture = textures.weather
  clouds.localWeatherRepeat.setScalar(1)
  clouds.localWeatherOffset.setScalar(0)
  clouds.scatteringCoefficient = layer.extinctionPerMeter
  clouds.absorptionCoefficient = 0
  clouds.coverage = 1
  clouds.shapeRepeat.setScalar(1 / layer.detail.shapeScaleMeters)
  clouds.shapeDetailRepeat.setScalar(1 / layer.detail.erosionScaleMeters)
  let seed = layer.detail.seed >>> 0 || 0x6d2b79f5
  const random = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }
  clouds.shapeOffset.set(random(), random(), random())
  clouds.shapeDetailOffset.set(random(), random(), random())
  let disposed = false
  return {
    setPlanetRotation(rotation) {
      if (!disposed)
        ecefToPlanet.setFromMatrix4(new Matrix4().makeRotationFromQuaternion(rotation.clone().normalize().invert()))
    },
    dispose() {
      if (disposed) return
      disposed = true
      materials.forEach((material, i) => {
        material.fragmentShader = originals[i].shader
        for (const name of Object.keys(shared)) {
          if (name in originals[i].uniforms) material.uniforms[name] = originals[i].uniforms[name]
          else delete material.uniforms[name]
        }
        material.needsUpdate = true
      })
      clouds.cloudLayers.copy(previous.layers)
      clouds.localWeatherTexture = previous.weather
      clouds.scatteringCoefficient = previous.scattering
      clouds.absorptionCoefficient = previous.absorption
      clouds.coverage = previous.coverage
      clouds.shapeRepeat.copy(previous.shapeRepeat)
      clouds.shapeDetailRepeat.copy(previous.detailRepeat)
      clouds.shapeOffset.copy(previous.shapeOffset)
      clouds.shapeDetailOffset.copy(previous.detailOffset)
      clouds.localWeatherRepeat.copy(previous.weatherRepeat)
      clouds.localWeatherOffset.copy(previous.weatherOffset)
    }
  }
}
