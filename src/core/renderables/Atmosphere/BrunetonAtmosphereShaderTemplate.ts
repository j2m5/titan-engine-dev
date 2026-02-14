/**
 * BrunetonAtmosphereShaderTemplate.ts
 *
 * Adaptation of Eric Bruneton's Precomputed Atmospheric Scattering (2017)
 * for use with Three.js RawShaderMaterial on spherical atmosphere meshes.
 *
 * This version uses PARAMETRIC atmosphere parameters (via uniforms)
 * instead of hardcoded Earth values. Works with any planet whose LUTs
 * have been precomputed via AtmosphereLUTGenerator.
 *
 * No built-in tone mapping — assumed to be handled by post-processing.
 * No #version 300 es — Three.js injects it via glslVersion: GLSL3.
 */

import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Matrix4, Uniform, Vector2, Vector3 } from 'three'
import { createParametricAtmosphereShader } from './atmosphereParametric'
import { createAtmosphereUniforms, EARTH_ATMOSPHERE } from './AtmosphereConfig'

const parametricAtmosphere = createParametricAtmosphereShader()
const SUN_ANGULAR_RADIUS = 0.0004675

export const BrunetonAtmosphereShaderTemplate: ShaderProps = {
  uniforms: {
    // ── Three.js standard uniforms (manual for RawShaderMaterial) ──
    modelMatrix: new Uniform(new Matrix4()),
    modelViewMatrix: new Uniform(new Matrix4()),
    projectionMatrix: new Uniform(new Matrix4()),
    cameraPosition: new Uniform(new Vector3()),

    // ── Scene parameters ──
    lightPosition: new Uniform(new Vector3()),
    inverseSpaceScale: new Uniform(1.0 / Math.pow(10, -3.3)),

    // ── Atmosphere parameters (from AtmosphereConfig) ──
    // These are populated by createAtmosphereUniforms() / material.setAtmosphereConfig()
    ...createAtmosphereUniforms(EARTH_ATMOSPHERE),

    // ── Rendering parameters ──
    exposure: new Uniform(10.0),
    white_point: new Uniform(new Vector3(1.0, 1.0, 1.0)),
    sun_size: new Uniform(new Vector2(Math.tan(SUN_ANGULAR_RADIUS), Math.cos(SUN_ANGULAR_RADIUS))),

    transmittance_texture: new Uniform(null),
    scattering_texture: new Uniform(null),
    irradiance_texture: new Uniform(null),
    single_mie_scattering_texture: new Uniform(null),

    // ── Logarithmic depth buffer ──
    logDepthBufFC: new Uniform(0)
  },

  // ════════════════════════════════════════════════════════════════════
  // VERTEX SHADER
  // ════════════════════════════════════════════════════════════════════
  vertexShader: /* glsl */ `
precision highp float;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

uniform vec3 lightPosition;
uniform float inverseSpaceScale;

in vec3 position;

out vec3 vPositionKm;
out vec3 vCameraPositionKm;
out vec3 vSunDirection;
out float vFragDepth;
out float vIsPerspective;

bool isPerspectiveMatrix(mat4 m) {
  return m[2][3] == -1.0;
}

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  mat4 invModelMatrix = inverse(modelMatrix);
  vec3 localCameraPos = (invModelMatrix * vec4(cameraPosition, 1.0)).xyz;

  vec3 meshWorldCenter = modelMatrix[3].xyz;
  vec3 worldSunDir = normalize(lightPosition - meshWorldCenter);
  vec3 localSunDir = normalize((invModelMatrix * vec4(worldSunDir, 0.0)).xyz);

  // Local space → kilometers
  vPositionKm = position * inverseSpaceScale;
  vCameraPositionKm = localCameraPos * inverseSpaceScale;
  vSunDirection = localSunDir;

  vFragDepth = 1.0 + gl_Position.w;
  vIsPerspective = float(isPerspectiveMatrix(projectionMatrix));
}
`,

  // ════════════════════════════════════════════════════════════════════
  // FRAGMENT SHADER
  // ════════════════════════════════════════════════════════════════════
  fragmentShader: /* glsl */ `
// ── Parametric Bruneton atmosphere core ──
// This is atmosphere.js with the hardcoded ATMOSPHERE constant replaced by
// uniform-driven buildAtmosphere(). All 1200+ lines of LUT lookup functions
// are preserved unchanged. The #define ATMOSPHERE macro ensures existing
// wrapper functions (GetSkyRadiance etc.) use our parametric values.
${parametricAtmosphere}

uniform float exposure;
uniform vec3 white_point;
uniform vec2 sun_size;
uniform float logDepthBufFC;

in vec3 vPositionKm;
in vec3 vCameraPositionKm;
in vec3 vSunDirection;
in float vFragDepth;
in float vIsPerspective;

layout(location = 0) out vec4 fragColor;

void main() {
  vec3 camera = vCameraPositionKm;
  vec3 viewDirection = normalize(vPositionKm - camera);
  vec3 sunDir = normalize(vSunDirection);

  // Use parametric bottom_radius from uniforms (not hardcoded 6360)
  float bottomR = u_bottom_radius;
  float topR = u_top_radius;

  float r = length(camera);

  // Clamp camera radius to valid atmosphere bounds
  float rClamped = max(r, bottomR + 0.01);

  vec3 cameraClamped = camera;
  if (r > 0.001) {
    cameraClamped = camera * (rClamped / r);
  } else {
    cameraClamped = vec3(0.0, rClamped, 0.0);
  }

  float rFinal = length(cameraClamped);
  float mu = dot(normalize(cameraClamped), viewDirection);

  // Compute atmosphere scattering using wrapper functions from atmosphere.js
  // (which now use buildAtmosphere() via #define ATMOSPHERE)
  vec3 transmittance;
  vec3 radiance;

  bool hitsGround = RayIntersectsGround(ATMOSPHERE, rFinal, mu);

  if (hitsGround) {
    float groundDist = DistanceToBottomAtmosphereBoundary(ATMOSPHERE, rFinal, mu);
    vec3 groundPoint = cameraClamped + viewDirection * groundDist;

    radiance = GetSkyRadianceToPoint(
      cameraClamped, groundPoint, 0.0, sunDir, transmittance);
  } else {
    radiance = GetSkyRadiance(
      cameraClamped, viewDirection, 0.0, sunDir, transmittance);

    if (dot(viewDirection, sunDir) > sun_size.y) {
      radiance += transmittance * GetSolarRadiance();
    }
  }

  // No tone mapping — handled by post-processing
  vec3 color = radiance * exposure;

  float alpha = 1.0 - dot(transmittance, vec3(1.0 / 3.0));

  fragColor = vec4(color, clamp(alpha, 0.0, 1.0));

  gl_FragDepth = vIsPerspective == 0.0
    ? gl_FragCoord.z
    : log2(vFragDepth) * logDepthBufFC * 0.5;
}
`
}
