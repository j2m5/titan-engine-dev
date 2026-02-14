/**
 * BrunetonAtmosphereShaderTemplate.ts
 *
 * Adaptation of Eric Bruneton's Precomputed Atmospheric Scattering (2017)
 * for use with Three.js RawShaderMaterial on spherical atmosphere meshes.
 *
 * Key features:
 * - Works on sphere mesh geometry (not fullscreen quad)
 * - Per-planet radius scaling: any planet's radii are mapped to Bruneton's
 *   Earth reference (6360/6420 km) so precomputed LUTs remain valid
 * - Supports camera both outside and inside the atmosphere
 * - No built-in tone mapping (assumed to be handled by post-processing)
 * - Logarithmic depth buffer for cosmic-scale rendering
 * - GLSL 300 es (WebGL2) via RawShaderMaterial with glslVersion: GLSL3
 *
 * IMPORTANT: Do NOT add `#version 300 es` to shader strings.
 * Three.js injects it automatically when glslVersion: GLSL3 is set.
 */

import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Matrix4, Uniform, Vector2, Vector3 } from 'three'
import { atmosphereShader } from './atmosphere'

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

    // ── Per-planet radius parameters (in real kilometers) ──
    // These define the actual planet surface and atmosphere extent.
    // The shader scales all positions so that:
    //   bottomRadiusKm → ATMOSPHERE.bottom_radius (6360 km)
    //   topRadiusKm    → scaled proportionally
    // This keeps the precomputed Earth LUTs valid for any planet.
    bottomRadiusKm: new Uniform(6360.0),
    topRadiusKm: new Uniform(6420.0),

    // ── Bruneton rendering parameters ──
    exposure: new Uniform(10.0),
    white_point: new Uniform(new Vector3(1.0, 1.0, 1.0)),
    sun_size: new Uniform(new Vector2(Math.tan(SUN_ANGULAR_RADIUS), Math.cos(SUN_ANGULAR_RADIUS))),

    // ── Precomputed LUT textures ──
    transmittance_texture: new Uniform(null),
    scattering_texture: new Uniform(null),
    single_mie_scattering_texture: new Uniform(null),
    irradiance_texture: new Uniform(null),

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
uniform float bottomRadiusKm;

in vec3 position;

out vec3 vPositionKm;
out vec3 vCameraPositionKm;
out vec3 vSunDirection;
out float vRadiusScale;
out float vFragDepth;
out float vIsPerspective;

bool isPerspectiveMatrix(mat4 m) {
  return m[2][3] == -1.0;
}

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // ── Local space → km ──
  mat4 invModelMatrix = inverse(modelMatrix);
  vec3 localCameraPos = (invModelMatrix * vec4(cameraPosition, 1.0)).xyz;

  // Sun direction from mesh center toward the light (uniform across sphere)
  vec3 meshWorldCenter = modelMatrix[3].xyz;
  vec3 worldSunDir = normalize(lightPosition - meshWorldCenter);
  vec3 localSunDir = normalize((invModelMatrix * vec4(worldSunDir, 0.0)).xyz);

  // Convert local space → real kilometers
  vPositionKm = position * inverseSpaceScale;
  vCameraPositionKm = localCameraPos * inverseSpaceScale;
  vSunDirection = localSunDir;

  // ── Radius scale factor ──
  // Maps actual planet radius to Bruneton's expected 6360 km.
  // Computed in vertex shader to avoid redundant division per fragment.
  // ATMOSPHERE.bottom_radius = 6360.0 (hardcoded in atmosphere.js)
  vRadiusScale = 6360.0 / bottomRadiusKm;

  // ── Logarithmic depth buffer ──
  vFragDepth = 1.0 + gl_Position.w;
  vIsPerspective = float(isPerspectiveMatrix(projectionMatrix));
}
`,

  // ════════════════════════════════════════════════════════════════════
  // FRAGMENT SHADER
  // ════════════════════════════════════════════════════════════════════
  fragmentShader: /* glsl */ `
// ── Bruneton atmosphere core (precomputed scattering functions + LUT lookups) ──
${atmosphereShader}

uniform float exposure;
uniform vec3 white_point;
uniform vec2 sun_size;
uniform float logDepthBufFC;

in vec3 vPositionKm;
in vec3 vCameraPositionKm;
in vec3 vSunDirection;
in float vRadiusScale;
in float vFragDepth;
in float vIsPerspective;

layout(location = 0) out vec4 fragColor;

void main() {
  // ── Radius scaling ──
  // Map this planet's coordinates into Bruneton's reference frame
  // where bottom_radius = 6360 km, so precomputed LUTs remain valid.
  //
  // Example for Mars (bottomRadiusKm = 3390):
  //   vRadiusScale = 6360 / 3390 ≈ 1.876
  //   camera at surface → r = 3390 * 1.876 = 6360 km ✓
  vec3 camera = vCameraPositionKm * vRadiusScale;
  vec3 vertexKm = vPositionKm * vRadiusScale;

  vec3 viewDirection = normalize(vertexKm - camera);
  vec3 sunDir = normalize(vSunDirection);

  float r = length(camera);

  // ── Clamp camera radius ──
  // Ensure camera is within valid atmosphere bounds for LUT lookups.
  // Slightly above bottom_radius to avoid boundary artifacts.
  float rClamped = max(r, ATMOSPHERE.bottom_radius + 0.01);

  vec3 cameraClamped = camera;
  if (r > 0.001) {
    cameraClamped = camera * (rClamped / r);
  } else {
    cameraClamped = vec3(0.0, rClamped, 0.0);
  }

  float rFinal = length(cameraClamped);
  float mu = dot(normalize(cameraClamped), viewDirection);

  // ── Atmosphere computation ──
  vec3 transmittance;
  vec3 radiance;

  bool hitsGround = RayIntersectsGround(ATMOSPHERE, rFinal, mu);

  if (hitsGround) {
    // Aerial perspective: scattering between camera and planet surface
    float groundDist = DistanceToBottomAtmosphereBoundary(ATMOSPHERE, rFinal, mu);
    vec3 groundPoint = cameraClamped + viewDirection * groundDist;

    radiance = GetSkyRadianceToPoint(
      cameraClamped, groundPoint, 0.0, sunDir, transmittance);
  } else {
    // Full sky scattering (ray passes through atmosphere without hitting ground)
    radiance = GetSkyRadiance(
      cameraClamped, viewDirection, 0.0, sunDir, transmittance);

    // Sun disc
    if (dot(viewDirection, sunDir) > sun_size.y) {
      radiance += transmittance * GetSolarRadiance();
    }
  }

  // ── Output ──
  // No tone mapping here — handled by post-processing pipeline.
  // Apply exposure scaling only.
  vec3 color = radiance * exposure;

  // Alpha from transmittance:
  //   transmittance ≈ (1,1,1) → fully transparent (alpha ≈ 0)
  //   transmittance ≈ (0,0,0) → fully opaque atmosphere (alpha ≈ 1)
  float alpha = 1.0 - dot(transmittance, vec3(1.0 / 3.0));

  fragColor = vec4(color, clamp(alpha, 0.0, 1.0));

  // ── Logarithmic depth buffer ──
  gl_FragDepth = vIsPerspective == 0.0
    ? gl_FragCoord.z
    : log2(vFragDepth) * logDepthBufFC * 0.5;
}
`
}
