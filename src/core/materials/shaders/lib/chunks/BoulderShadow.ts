import { Matrix4, Texture, Uniform, Vector4 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import {
  BOULDER_SHADOW_DEPTH_METERS,
  BOULDER_SHADOW_FADE_METERS,
  BOULDER_SHADOW_SIZE
} from '@/core/terrain/boulderShadowFrame'

export function createBoulderShadowUniforms(sizeScale = 1) {
  return {
    uBoulderShadowMap: new Uniform<Texture | null>(null),
    uBoulderShadowMatrix: new Uniform(new Matrix4()),
    uBoulderShadowStrength: new Uniform(0),
    uBoulderShadowSettings: new Uniform(
      new Vector4(
        1 / BOULDER_SHADOW_SIZE,
        0.04 / BOULDER_SHADOW_DEPTH_METERS,
        toThreeJSUnits((BOULDER_SHADOW_FADE_METERS[0] * sizeScale) / 1000),
        toThreeJSUnits((BOULDER_SHADOW_FADE_METERS[1] * sizeScale) / 1000)
      )
    )
  }
}

export const boulderShadowUniforms = `
  uniform sampler2D uBoulderShadowMap;
  uniform mat4 uBoulderShadowMatrix;
  uniform float uBoulderShadowStrength;
  // inverse map size, normalized metric bias, near/far fade in scene units
  uniform vec4 uBoulderShadowSettings;
`

export const boulderShadowFunctions = `
  float boulderShadowTap(vec2 uv, vec3 receiver, vec2 planeGradient) {
    float expected = receiver.z + dot(planeGradient, uv - receiver.xy) - uBoulderShadowSettings.y;
    return step(expected, texture2D(uBoulderShadowMap, uv).r);
  }

  float boulderShadowVisibility(vec3 viewPosition) {
    if (uBoulderShadowStrength <= 0.0) return 1.0;
    vec3 p = (uBoulderShadowMatrix * vec4(viewPosition, 1.0)).xyz;
    // Derivatives precede pixel-dependent gates. Correct the receiver plane at each tap,
    // so a sloping lit surface does not shadow itself through the filter footprint.
    vec3 dx = dFdx(p), dy = dFdy(p);
    float det = dx.x * dy.y - dx.y * dy.x;
    vec2 planeGradient = vec2(0.0);
    if (abs(det) > 1e-12)
      planeGradient = vec2(dx.z * dy.y - dy.z * dx.y, dy.z * dx.x - dx.z * dy.x) / det;
    if (any(lessThan(p, vec3(0.0))) || any(greaterThan(p, vec3(1.0)))) return 1.0;
    float rangeFade = 1.0 - smoothstep(uBoulderShadowSettings.z, uBoulderShadowSettings.w, length(viewPosition));
    float invSize = uBoulderShadowSettings.x;
    float borderDistance = min(min(p.x, p.y), min(1.0 - p.x, 1.0 - p.y));
    float borderFade = smoothstep(0.0, min(4.0 * invSize, 0.1), borderDistance);
    float weight = uBoulderShadowStrength * rangeFade * borderFade;
    if (weight <= 0.0) return 1.0;
    vec2 grid = p.xy / invSize - 0.5;
    vec2 fraction = fract(grid);
    vec2 base = (floor(grid) + 0.5) * invSize;
    float a = boulderShadowTap(base, p, planeGradient);
    float b = boulderShadowTap(base + vec2(invSize, 0.0), p, planeGradient);
    float c = boulderShadowTap(base + vec2(0.0, invSize), p, planeGradient);
    float d = boulderShadowTap(base + vec2(invSize), p, planeGradient);
    float visibility = mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
    return mix(1.0, visibility, weight);
  }
`
