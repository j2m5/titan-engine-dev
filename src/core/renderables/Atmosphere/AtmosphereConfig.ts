/**
 * AtmosphereConfig.ts
 *
 * Defines atmosphere parameters for Bruneton's precomputed scattering model.
 * Provides presets for known planets and a helper to create shader uniforms.
 */

import { Uniform, Vector3 } from 'three'
import { IUniform } from 'three/src/renderers/shaders/UniformsLib'

export const EMPTY_LAYER: DensityProfileLayer = {
  width: 0,
  expTerm: 0,
  expScale: 0,
  linearTerm: 0,
  constantTerm: 0
}

export const EARTH_SOLAR: [number, number, number] = [1.474, 1.8504, 1.91198]

export function solarIrradiance(dAU: number): [number, number, number] {
  const f = 1.0 / (dAU * dAU)
  return [EARTH_SOLAR[0] * f, EARTH_SOLAR[1] * f, EARTH_SOLAR[2] * f]
}

export function sunAngle(dAU: number): number {
  return Math.atan(695700 / (dAU * 149597870.7))
}

/** Scale Earth Rayleigh by a factor (preserves λ⁻⁴ wavelength ratio) */
export function scaleRayleigh(factor: number): [number, number, number] {
  return [0.005802 * factor, 0.013558 * factor, 0.0331 * factor]
}

/** Exponential density layer: ρ(h) = expTerm × exp(expScale × h) */
export function expLayer(scaleHeight: number): DensityProfileLayer {
  return { width: 0, expTerm: 1, expScale: -1.0 / scaleHeight, linearTerm: 0, constantTerm: 0 }
}

export interface DensityProfileLayer {
  width: number
  expTerm: number
  expScale: number
  linearTerm: number
  constantTerm: number
}

export interface AtmosphereConfig {
  solarIrradiance: [number, number, number]
  sunAngularRadius: number // radians
  bottomRadius: number
  topRadius: number
  rayleighDensity: [DensityProfileLayer, DensityProfileLayer]
  rayleighScattering: [number, number, number] // 1/km
  mieDensity: [DensityProfileLayer, DensityProfileLayer]
  mieScattering: [number, number, number] // 1/km
  mieExtinction: [number, number, number] // 1/km
  miePhaseFunctionG: number // asymmetry parameter [-1, 1]
  absorptionDensity: [DensityProfileLayer, DensityProfileLayer]
  absorptionExtinction: [number, number, number] // 1/km
  groundAlbedo: [number, number, number]
  muSMin: number
}

/**
 * Create a flat array from a DensityProfileLayer for use as a GLSL float[5] uniform.
 */
function layerToArray(layer: DensityProfileLayer): Float32Array {
  return new Float32Array([layer.width, layer.expTerm, layer.expScale, layer.linearTerm, layer.constantTerm])
}

/**
 * Creates Three.js Uniform objects for all atmosphere parameters.
 * These are used by both the rendering shader and the precomputation shaders.
 */
export function createAtmosphereUniforms(config: AtmosphereConfig): Record<string, Uniform> {
  return {
    u_solar_irradiance: new Uniform(new Vector3(...config.solarIrradiance)),
    u_sun_angular_radius: new Uniform(config.sunAngularRadius),
    u_bottom_radius: new Uniform(config.bottomRadius),
    u_top_radius: new Uniform(config.topRadius),

    u_rayleigh_layer0: new Uniform(layerToArray(config.rayleighDensity[0])),
    u_rayleigh_layer1: new Uniform(layerToArray(config.rayleighDensity[1])),
    u_rayleigh_scattering: new Uniform(new Vector3(...config.rayleighScattering)),

    u_mie_layer0: new Uniform(layerToArray(config.mieDensity[0])),
    u_mie_layer1: new Uniform(layerToArray(config.mieDensity[1])),
    u_mie_scattering: new Uniform(new Vector3(...config.mieScattering)),
    u_mie_extinction: new Uniform(new Vector3(...config.mieExtinction)),
    u_mie_phase_function_g: new Uniform(config.miePhaseFunctionG),

    u_absorption_layer0: new Uniform(layerToArray(config.absorptionDensity[0])),
    u_absorption_layer1: new Uniform(layerToArray(config.absorptionDensity[1])),
    u_absorption_extinction: new Uniform(new Vector3(...config.absorptionExtinction)),

    u_ground_albedo: new Uniform(new Vector3(...config.groundAlbedo)),
    u_mu_s_min: new Uniform(config.muSMin)
  }
}

/**
 * Updates existing uniform values from a new config.
 * Avoids creating new Uniform objects — just updates .value.
 */
export function updateAtmosphereUniforms(uniforms: { [uniform: string]: IUniform }, config: AtmosphereConfig): void {
  uniforms.u_solar_irradiance.value.set(...config.solarIrradiance)
  uniforms.u_sun_angular_radius.value = config.sunAngularRadius
  uniforms.u_bottom_radius.value = config.bottomRadius
  uniforms.u_top_radius.value = config.topRadius

  uniforms.u_rayleigh_layer0.value = layerToArray(config.rayleighDensity[0])
  uniforms.u_rayleigh_layer1.value = layerToArray(config.rayleighDensity[1])
  uniforms.u_rayleigh_scattering.value.set(...config.rayleighScattering)

  uniforms.u_mie_layer0.value = layerToArray(config.mieDensity[0])
  uniforms.u_mie_layer1.value = layerToArray(config.mieDensity[1])
  uniforms.u_mie_scattering.value.set(...config.mieScattering)
  uniforms.u_mie_extinction.value.set(...config.mieExtinction)
  uniforms.u_mie_phase_function_g.value = config.miePhaseFunctionG

  uniforms.u_absorption_layer0.value = layerToArray(config.absorptionDensity[0])
  uniforms.u_absorption_layer1.value = layerToArray(config.absorptionDensity[1])
  uniforms.u_absorption_extinction.value.set(...config.absorptionExtinction)

  uniforms.u_ground_albedo.value.set(...config.groundAlbedo)
  uniforms.u_mu_s_min.value = config.muSMin
}
