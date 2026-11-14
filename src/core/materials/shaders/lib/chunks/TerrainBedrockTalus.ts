import { BEDROCK_SHAPE as S } from '@/core/terrain/bedrockShape'
import { MIDBAND_NYQUIST_LO, MIDBAND_NYQUIST_HI, MIDBAND_POLAR_COS } from '@/core/terrain/midbandField'

const gl = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v))

export const bedrockTalusUniforms = `
  // strength, layer step in meters, weathering, body radius in meters
  uniform vec4 uBedrockShape;
  // water level in meters, water enabled
  uniform vec2 uBedrockWater;
  uniform vec2 uBedrockFade;
`

export const bedrockTalusFunctions = `
  float bedrockJoint(float phase) {
    float a = abs(fract(phase) - 0.5), e = ${gl(S.jointRound)};
    if (a < e) return 1.0 - 2.0 * e - 2.0 * a * a / e;
    if (a > 0.5 - e) return -1.0 + 2.0 * e + 2.0 * (0.5 - a) * (0.5 - a) / e;
    return 1.0 - 4.0 * a;
  }

  float bedrockMaterialPhase(vec3 dir, float mapMeters) {
    float k = ${gl((2 * Math.PI) / S.warpPeriod)} * uBedrockShape.w;
    float warp = ${gl(S.warpA)} * sin(k * dot(dir, vec3(0.8, 0.48, -0.36)))
               + ${gl(S.warpB)} * sin(k * ${gl(S.warpRatio)} * dot(dir, vec3(-0.6, 0.8, 0.0)) + 2.7);
    float j = uBedrockShape.w / ${gl(S.jointPeriod)};
    warp += uBedrockShape.z * (
      ${gl(S.jointA)} * bedrockJoint(j * dot(dir, vec3(0.36, -0.48, 0.8))) +
      ${gl(S.jointB)} * bedrockJoint(j * ${gl(S.jointRatio)} * dot(dir, vec3(-0.8, -0.6, 0.0)) + 0.41));
    return mapMeters / uBedrockShape.y + warp;
  }

  float bedrockApron(float phase) {
    float p = fract(phase);
    return smoothstep(${gl(S.footStart)}, 0.18, p) * (1.0 - smoothstep(0.34, ${gl(S.footStart + S.footWidth)}, p));
  }

  float terrainBedrockTalus(vec3 dir, float mapMeters, float slopeTan, float viewDistance) {
    // Uniform early out preserves the original shaders on all other bodies.
    if (uBedrockShape.x <= 0.0 || uBedrockShape.z <= 0.0) return 0.0;
    float phase = bedrockMaterialPhase(dir, mapMeters);
    // Evaluate derivatives before any pixel-dependent branch.
    float footprint = fwidth(phase);
    float warpSlope = ${gl(((2 * Math.PI) / S.warpPeriod) * (S.warpA + S.warpB * S.warpRatio))} +
      uBedrockShape.z * ${gl((4 / S.jointPeriod) * (S.jointA + S.jointB * S.jointRatio))};
    float wavelength = uBedrockShape.y / (3.0 * (max(0.0, slopeTan) + uBedrockShape.y * warpSlope));
    float stepMeters = ${gl((2 * Math.PI) / (4 * 1024 * 64))} * uBedrockShape.w;
    float coverage = smoothstep(0.25, 0.65, slopeTan) *
      (1.0 - smoothstep(${gl(MIDBAND_NYQUIST_LO)}, ${gl(MIDBAND_NYQUIST_HI)}, stepMeters / wavelength));
    coverage *= smoothstep(0.0, ${gl(MIDBAND_POLAR_COS)}, length(dir.xz));
    coverage *= mix(1.0, smoothstep(0.0, uBedrockShape.y, abs(mapMeters - uBedrockWater.x)), uBedrockWater.y);
    coverage *= (1.0 - smoothstep(uBedrockFade.x, uBedrockFade.y, viewDistance));
    coverage *= (1.0 - smoothstep(0.06, 0.18, footprint));
    return bedrockApron(phase) * coverage * uBedrockShape.z * min(1.0, uBedrockShape.x / 0.45);
  }
`
