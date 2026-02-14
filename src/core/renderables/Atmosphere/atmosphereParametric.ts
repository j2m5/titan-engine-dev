/**
 * atmosphereParametric.ts
 *
 * Transforms the original Bruneton atmosphere shader string to replace
 * hardcoded Earth parameters with uniform-based parameters.
 *
 * The original atmosphere.js contains:
 *   const AtmosphereParameters ATMOSPHERE = AtmosphereParameters(...)  // Earth values
 *
 * This module replaces that constant with:
 *   1. Uniform declarations for all atmosphere parameters
 *   2. A buildAtmosphere() function that constructs AtmosphereParameters from uniforms
 *   3. A #define ATMOSPHERE so existing wrapper functions continue to work
 *
 * All other code (1200+ lines of math, LUT functions, texture uniforms,
 * wrapper functions) remains completely untouched.
 */

import { atmosphereShader } from './atmosphere'

/**
 * GLSL code that declares atmosphere parameter uniforms and provides
 * a builder function to construct AtmosphereParameters from them.
 *
 * Density profile layers are passed as float[5] arrays:
 *   [width, expTerm, expScale, linearTerm, constantTerm]
 */
const ATMOSPHERE_UNIFORMS_GLSL = /* glsl */ `
  // ── Atmosphere parameter uniforms ──
  uniform vec3 u_solar_irradiance;
  uniform float u_sun_angular_radius;
  uniform float u_bottom_radius;
  uniform float u_top_radius;

  uniform float u_rayleigh_layer0[5];
  uniform float u_rayleigh_layer1[5];
  uniform vec3 u_rayleigh_scattering;

  uniform float u_mie_layer0[5];
  uniform float u_mie_layer1[5];
  uniform vec3 u_mie_scattering;
  uniform vec3 u_mie_extinction;
  uniform float u_mie_phase_function_g;

  uniform float u_absorption_layer0[5];
  uniform float u_absorption_layer1[5];
  uniform vec3 u_absorption_extinction;

  uniform vec3 u_ground_albedo;
  uniform float u_mu_s_min;

  DensityProfileLayer buildLayer(float params[5]) {
    return DensityProfileLayer(params[0], params[1], params[2], params[3], params[4]);
  }

  AtmosphereParameters buildAtmosphere() {
    return AtmosphereParameters(
      u_solar_irradiance,
      u_sun_angular_radius,
      u_bottom_radius,
      u_top_radius,
      DensityProfile(DensityProfileLayer[2](
        buildLayer(u_rayleigh_layer0), buildLayer(u_rayleigh_layer1)
      )),
      u_rayleigh_scattering,
      DensityProfile(DensityProfileLayer[2](
        buildLayer(u_mie_layer0), buildLayer(u_mie_layer1)
      )),
      u_mie_scattering,
      u_mie_extinction,
      u_mie_phase_function_g,
      DensityProfile(DensityProfileLayer[2](
        buildLayer(u_absorption_layer0), buildLayer(u_absorption_layer1)
      )),
      u_absorption_extinction,
      u_ground_albedo,
      u_mu_s_min
    );
  }

  // Macro so that existing wrapper functions (GetSkyRadiance etc.)
  // which reference ATMOSPHERE continue to work unchanged.
  #define ATMOSPHERE buildAtmosphere()
`

/**
 * Creates a parametric version of the atmosphere shader where the hardcoded
 * Earth ATMOSPHERE constant is replaced with uniform-driven parameters.
 *
 * The returned GLSL string can be used in place of the original atmosphereShader
 * in any shader that needs configurable atmosphere parameters.
 */
export function createParametricAtmosphereShader(): string {
  // Match the hardcoded ATMOSPHERE constant declaration.
  // It spans multiple lines from "const AtmosphereParameters ATMOSPHERE = ..." to ");"
  const atmosphereConstRegex =
    /const\s+AtmosphereParameters\s+ATMOSPHERE\s*=\s*AtmosphereParameters\s*\([^;]+\);/s

  if (!atmosphereConstRegex.test(atmosphereShader)) {
    console.warn(
      'atmosphereParametric: Could not find hardcoded ATMOSPHERE constant in shader. ' +
      'The shader string may have changed. Returning original shader.'
    )
    return atmosphereShader
  }

  return atmosphereShader.replace(atmosphereConstRegex, ATMOSPHERE_UNIFORMS_GLSL)
}
