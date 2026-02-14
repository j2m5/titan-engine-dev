/**
 * AtmosphereConfig.ts
 *
 * Defines atmosphere parameters for Bruneton's precomputed scattering model.
 * Provides presets for known planets and a helper to create shader uniforms.
 */

import { Uniform, Vector3 } from 'three'
import { IUniform } from 'three/src/renderers/shaders/UniformsLib'

// ════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════

export interface DensityProfileLayer {
  width: number // km (0 = unbounded layer)
  expTerm: number // dimensionless
  expScale: number // 1/km (negative = density decreases with altitude)
  linearTerm: number // 1/km
  constantTerm: number // dimensionless
}

export interface AtmosphereConfig {
  // Star properties
  solarIrradiance: [number, number, number]
  sunAngularRadius: number // radians

  // Planet geometry (in km)
  bottomRadius: number // planet surface radius
  topRadius: number // atmosphere outer boundary

  // Rayleigh scattering (air molecules)
  rayleighDensity: [DensityProfileLayer, DensityProfileLayer]
  rayleighScattering: [number, number, number] // 1/km

  // Mie scattering (aerosols/particles)
  mieDensity: [DensityProfileLayer, DensityProfileLayer]
  mieScattering: [number, number, number] // 1/km
  mieExtinction: [number, number, number] // 1/km
  miePhaseFunctionG: number // asymmetry parameter [-1, 1]

  // Absorption (e.g. ozone)
  absorptionDensity: [DensityProfileLayer, DensityProfileLayer]
  absorptionExtinction: [number, number, number] // 1/km

  // Surface
  groundAlbedo: [number, number, number]

  // Minimum cosine of sun zenith angle for which scattering is precomputed
  muSMin: number
}

// ════════════════════════════════════════════════════════════════════
// Presets
// ════════════════════════════════════════════════════════════════════

const EMPTY_LAYER: DensityProfileLayer = {
  width: 0,
  expTerm: 0,
  expScale: 0,
  linearTerm: 0,
  constantTerm: 0
}

/**
 * Earth atmosphere parameters from Bruneton's reference implementation.
 * Rayleigh scale height: 8 km (expScale = -1/8 = -0.125)
 * Mie scale height: 1.2 km (expScale = -1/1.2 ≈ -0.833)
 * Ozone layer centered at ~25 km
 */
export const EARTH_ATMOSPHERE: AtmosphereConfig = {
  solarIrradiance: [1.474, 1.8504, 1.91198],
  sunAngularRadius: 0.004675,
  bottomRadius: 6360.0,
  topRadius: 6420.0,
  rayleighDensity: [EMPTY_LAYER, { width: 0, expTerm: 1, expScale: -0.125, linearTerm: 0, constantTerm: 0 }],
  rayleighScattering: [0.005802, 0.013558, 0.0331],
  mieDensity: [EMPTY_LAYER, { width: 0, expTerm: 1, expScale: -0.833333, linearTerm: 0, constantTerm: 0 }],
  mieScattering: [0.003996, 0.003996, 0.003996],
  mieExtinction: [0.00444, 0.00444, 0.00444],
  miePhaseFunctionG: 0.8,
  absorptionDensity: [
    { width: 25, expTerm: 0, expScale: 0, linearTerm: 0.066667, constantTerm: -0.666667 },
    { width: 0, expTerm: 0, expScale: 0, linearTerm: -0.066667, constantTerm: 2.666667 }
  ],
  absorptionExtinction: [0.00065, 0.001881, 0.000085],
  groundAlbedo: [0.1, 0.1, 0.1],
  muSMin: -0.207912
}

// ════════════════════════════════════════════════════════════════════
// Uniform creation helpers
// ════════════════════════════════════════════════════════════════════

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
