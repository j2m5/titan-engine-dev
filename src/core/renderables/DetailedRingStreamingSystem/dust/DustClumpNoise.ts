import { DataTexture, FloatType, NearestFilter, RepeatWrapping, RGBAFormat } from 'three'

const PERIOD = 289

/** The same 3D simplex gradients as Noise.ts, with two permutation stages
 * precomputed: texel(x, y) = gradient(permute(permute(y) + x)).
 * This caches a finite gradient set, not samples of the spatial noise field.
 * RGBA32F costs 1,336,336 bytes; retain CPU pixels for context restoration. */
export function createDustClumpGradientTexture(): DataTexture {
  const f = Math.fround
  // Integer intermediates for x <= 577 fit exactly in float32 (< 2^24).
  const permute = (x: number): number => ((34 * x + 1) * x) % PERIOD
  const n = f(1 / 7), nx = f(n * 2), ny = f(f(n * 0.5) - 1)
  const gradients = Array.from({ length: PERIOD }, (_, p) => {
    // Round constants and operations like the original GLSL octahedral gradient
    // construction and Taylor normalization, rather than using unit vectors.
    const j = p - 49 * Math.floor(f(f(p * n) * n))
    const a = Math.floor(f(j * n)), b = Math.floor(j - 7 * a)
    const x = f(f(a * nx) + ny), y = f(f(b * nx) + ny)
    const h = f(f(1 - Math.abs(x)) - Math.abs(y))
    const sh = h <= 0 ? -1 : 0
    const gx = f(x + (Math.floor(x) * 2 + 1) * sh)
    const gy = f(y + (Math.floor(y) * 2 + 1) * sh)
    const lengthSquared = f(f(f(gx * gx) + f(gy * gy)) + f(h * h))
    const norm = f(f(1.79284291400159) - f(f(0.85373472095314) * lengthSquared))
    return [f(gx * norm), f(gy * norm), f(h * norm), 1]
  })
  const pixels = new Float32Array(PERIOD * PERIOD * 4)
  for (let y = 0; y < PERIOD; y++) {
    const py = permute(y)
    for (let x = 0; x < PERIOD; x++) {
      pixels.set(gradients[permute(py + x)], (y * PERIOD + x) * 4)
    }
  }
  const texture = new DataTexture(pixels, PERIOD, PERIOD, RGBAFormat, FloatType)
  texture.name = 'Dust clump gradients'
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/** Dust-only version of Noise.ts snoise(vec3). Keep skew, corner ordering,
 * kernel and arithmetic order in sync; the browser probe compares both GLSL
 * paths. Shared terrain/star noise and its CPU mirror remain independent. */
export const dustClumpNoiseFunctions = `
  uniform sampler2D uDustClumpGradients;

  vec4 dustClumpPermute(vec4 x) {
    vec4 p = ((x * 34.0) + 1.0) * x;
    return p - floor(p * (1.0 / 289.0)) * 289.0;
  }

  float dustClumpNoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

    i = mod(i, 289.0);
    vec4 gx = i.x + vec4(0.0, i1.x, i2.x, 1.0);
    vec4 gy = dustClumpPermute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0);
    // Nearest/repeat fetches the exact gradient, wrapping both permutations'
    // period. Explicit LOD avoids derivative work inside the raymarch loop.
    vec3 p0 = textureLod(uDustClumpGradients, (vec2(gx.x, gy.x) + 0.5) / 289.0, 0.0).xyz;
    vec3 p1 = textureLod(uDustClumpGradients, (vec2(gx.y, gy.y) + 0.5) / 289.0, 0.0).xyz;
    vec3 p2 = textureLod(uDustClumpGradients, (vec2(gx.z, gy.z) + 0.5) / 289.0, 0.0).xyz;
    vec3 p3 = textureLod(uDustClumpGradients, (vec2(gx.w, gy.w) + 0.5) / 289.0, 0.0).xyz;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`
