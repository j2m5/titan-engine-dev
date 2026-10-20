import { Uniform, Vector3, type Texture } from 'three'
import { buildAtmosphereCoreGlsl } from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'

export interface WaterSkyUniformValues {
  uWaterSkyScattering: Texture | null
  uWaterSkyRayleigh: Vector3
  uWaterSkyMie: Vector3
  uWaterSkyMieG: number
  uWaterSkyMuSMin: number
  uWaterSkyExposure: number
  uWaterSkyHdrKnee: number
}

export function createWaterSkyUniforms(): { [K in keyof WaterSkyUniformValues]: Uniform<WaterSkyUniformValues[K]> } {
  return {
    uWaterSkyScattering: new Uniform(null),
    uWaterSkyRayleigh: new Uniform(new Vector3()),
    uWaterSkyMie: new Uniform(new Vector3()),
    uWaterSkyMieG: new Uniform(0),
    uWaterSkyMuSMin: new Uniform(-0.2),
    uWaterSkyExposure: new Uniform(10),
    uWaterSkyHdrKnee: new Uniform(1)
  }
}

const core = buildAtmosphereCoreGlsl()
const cleanup = [...new Set([...core.matchAll(/^\s*#define\s+(\w+)/gm)].map(match => match[1]))]
  .map(name => `#undef ${name}`).join('\n')

// Reuse exactly the LUT parameterization of the visible atmosphere. No second
// sky simulation, hardcoded sun, cube-map stars or display gamma in this layer.
export const waterSkyFunctions = /* glsl */ `
  #if defined(USE_WATER_SKY) && defined(USE_SUN_TINT)
    ${core}
    uniform sampler3D uWaterSkyScattering;
    uniform vec3 uWaterSkyRayleigh;
    uniform vec3 uWaterSkyMie;
    uniform float uWaterSkyMieG;
    uniform float uWaterSkyMuSMin;
    uniform float uWaterSkyExposure;
    uniform float uWaterSkyHdrKnee;

    vec3 waterSkyRadiance(vec3 up, vec3 reflectedRay, vec3 sun, vec3 eclipse) {
      // Density profiles and extinction are used during precomputation only;
      // runtime lookup needs radii, scattering coefficients and phase function.
      DensityProfileLayer zeroLayer = DensityProfileLayer(0.0, 0.0, 0.0, 0.0, 0.0);
      DensityProfile unusedDensity = DensityProfile(DensityProfileLayer[2](zeroLayer, zeroLayer));
      AtmosphereParameters atmosphere = AtmosphereParameters(
        vec3(1.0), uAtmoSunAngularRadius, uAtmoBottomRadius, uAtmoTopRadius,
        unusedDensity, uWaterSkyRayleigh, unusedDensity, uWaterSkyMie, vec3(0.0),
        uWaterSkyMieG, unusedDensity, vec3(0.0), vec3(0.0), uWaterSkyMuSMin
      );
      // A tilted wave can reflect below the coarse shell's horizon. Approximate
      // its masked environment with the horizon, without sampling through ground.
      vec3 ray = normalize(reflectedRay + up * max(0.001 - dot(up, reflectedRay), 0.0));
      float radius = clamp(uAtmoDatumRadius, uAtmoBottomRadius + 0.001, uAtmoTopRadius - 0.001);
      vec3 transmittance;
      vec3 sky = GetSkyRadiance(atmosphere, uAtmoTransmittance,
        uWaterSkyScattering, uWaterSkyScattering, up * radius, ray, 0.0, sun, transmittance);
      // Match the visible atmosphere: attenuate solar radiance before its
      // nonlinear HDR knee, including coloured light transmitted in the umbra.
      sky = max(sky * eclipse * uWaterSkyExposure, vec3(0.0));
      return min(min(sky, vec3(1.0)) + max(sky - 1.0, 0.0) * uWaterSkyHdrKnee, vec3(64.0));
    }
    ${cleanup}
    #define PI 3.141592653589793
  #endif
`
