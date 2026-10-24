import {
  Color,
  Matrix4,
  Uniform,
  UniformsUtils,
  ShaderMaterial,
  RepeatWrapping,
  ClampToEdgeWrapping,
  Texture,
  type PerspectiveCamera,
  type Vector2,
  type Vector3,
  type Data3DTexture
} from 'three'
import type { AtmosphereShadow, PrecomputedTextures } from '@takram/three-atmosphere'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { farGlintAlpha2 } from '@/core/materials/shaders/lib/chunks/waterOctavesMath'
import type { EarthTextures } from './earthAssets'
import { buildEarthSurfaceShader } from './earthSurfaceShader'
import { bindEarthCloudShadowReceiver, type EarthCloudShadowReceiver } from './earthCloudShadow'
export { buildEarthSurfaceShader } from './earthSurfaceShader'
export interface EarthSurfaceFrame {
  camera: PerspectiveCamera
  planetMatrixWorld: Matrix4
  worldToECEFMatrix: Matrix4
  sunDirection: Vector3
  resolution: Vector2
  frame: number
}
export interface EarthSurfaceOptions {
  textures: EarthTextures
  radiusMeters: number
  atmosphere: AtmosphereConfig
  lut: Pick<PrecomputedTextures, 'transmittanceTexture' | 'irradianceTexture'>
  stbnTexture: Data3DTexture
  longitudeOffsetRadians: number
  shadowReferenceShader: string
}
export interface EarthSurfacePair {
  far: ShaderMaterial
  near: ShaderMaterial
  volumeError: Error | null
  updateFrame(frame: EarthSurfaceFrame): void
  setMapEnabled(enabled: boolean): void
  bindShadow(shadow: AtmosphereShadow | null): void
  dispose(): void
}
export function createEarthSurfaceMaterials(options: EarthSurfaceOptions): EarthSurfacePair {
  const owned: Texture[] = []
  const view = (source: Texture) => {
    const t = source.clone()
    t.repeat.set(1, 1)
    t.offset.set(0, 0)
    t.center.set(0, 0)
    t.rotation = 0
    t.wrapS = RepeatWrapping
    t.wrapT = ClampToEdgeWrapping
    t.needsUpdate = true
    owned.push(t)
    return t
  }
  // Resolve the fatal far shader before allocating any owned resources.
  const farShader = buildEarthSurfaceShader(
    SphereSurfaceShaderTemplate.vertexShader,
    SphereSurfaceShaderTemplate.fragmentShader,
    'far',
    options.shadowReferenceShader
  )
  const textures = {
    diffuseMap: view(options.textures.surface),
    nightMap: view(options.textures.night),
    specularMap: view(options.textures.specular),
    earthCloudMap: view(options.textures.clouds)
  }
  const values = {
    ...textures,
    uBodyRadiusUnits: options.radiusMeters,
    emission: 1,
    uTerrainLambert: 1,
    uTerrainAmbient: 0.18,
    uTerrainAmbientSunRef: 0.3,
    uTerrainOcclusionDirect: 0.35,
    uSkyAmbientStrength: 1,
    uNightThreshold: 0.06,
    uNightSoftness: 0.18,
    uAtmoTransmittance: options.lut.transmittanceTexture,
    uAtmoIrradiance: options.lut.irradianceTexture,
    uAtmoBottomRadius: options.atmosphere.bottomRadius,
    uAtmoTopRadius: options.atmosphere.topRadius,
    uAtmoDatumRadius: options.radiusMeters / 1000,
    uAtmoSunAngularRadius: options.atmosphere.sunAngularRadius,
    uSunTintStrength: 1,
    uWaterGlintGain: 1,
    uWaterFarAlpha2: farGlintAlpha2(0.02, 1),
    uLightColor: new Color(1, 1, 1),
    earthPlanetToWorld: new Matrix4(),
    earthLongitudeOffset: options.longitudeOffsetRadians,
    earthSurfaceMapEnabled: true
  }
  function material(shader: ReturnType<typeof buildEarthSurfaceShader>) {
    const uniforms = UniformsUtils.clone(SphereSurfaceShaderTemplate.uniforms)
    for (const [name, value] of Object.entries(values))
      uniforms[name] = new Uniform(value instanceof Matrix4 || value instanceof Color ? value.clone() : value)
    return new ShaderMaterial({
      ...shader,
      uniforms,
      defines: { USE_NIGHT: 1, USE_SPECULAR: 1, USE_SUN_TINT: 1, USE_SKY_AMBIENT: 1 },
      toneMapped: false
    })
  }
  const far = material(farShader)
  let near: ShaderMaterial | undefined,
    receiver: EarthCloudShadowReceiver | undefined,
    volumeError: Error | null = null
  try {
    near = material(
      buildEarthSurfaceShader(
        SphereSurfaceShaderTemplate.vertexShader,
        SphereSurfaceShaderTemplate.fragmentShader,
        'near',
        options.shadowReferenceShader
      )
    )
    receiver = bindEarthCloudShadowReceiver(near, options)
  } catch (error) {
    receiver?.dispose()
    near?.dispose()
    near = far.clone()
    // UniformsUtils.clone also clones Texture objects. Reuse the pair's owned
    // map views and borrowed LUTs, releasing the unused clone wrappers.
    for (const [name, uniform] of Object.entries(far.uniforms)) {
      if (uniform.value instanceof Texture) {
        if (near.uniforms[name].value !== uniform.value) near.uniforms[name].value.dispose()
        near.uniforms[name].value = uniform.value
      }
    }
    volumeError = error instanceof Error ? error : new Error(String(error))
  }
  const nearMaterial = near
  let disposed = false
  return {
    far,
    near: nearMaterial,
    volumeError,
    updateFrame(frame) {
      for (const m of [far, nearMaterial]) {
        m.uniforms.earthPlanetToWorld.value.copy(frame.planetMatrixWorld)
        m.uniforms.lightPosition.value
          .setFromMatrixPosition(frame.planetMatrixWorld)
          .addScaledVector(frame.sunDirection.clone().normalize(), 149597870700)
      }
      receiver?.updateFrame(frame)
    },
    setMapEnabled(enabled) {
      far.uniforms.earthSurfaceMapEnabled.value = enabled
    },
    bindShadow(shadow) {
      receiver?.bind(shadow)
    },
    dispose() {
      if (disposed) return
      disposed = true
      receiver?.dispose()
      far.dispose()
      nearMaterial.dispose()
      owned.forEach((t) => t.dispose())
    }
  }
}
