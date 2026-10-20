import {
  octaveWeight,
  WATER_GLINT_CEILING,
  WATER_GLINT_F0,
  WATER_MIN_ALPHA2,
  type Vec3
} from './waterOctavesMath'

// Quantize wave vectors on long domains that divide the 40960 m RTC wrap.
// Short power-of-two domains with orthogonal headings made every band repeat
// the same 160 m tile. These nearby wind headings retain similar wavelengths
// without locking the crests into a crossed grid. Shared with the GLSL generator.
export const OCEAN_WAVES = [
  { direction: [75, 26, 119], period: 10240, amplitude: 0.8, phase: 0.3 },
  { direction: [94, -17, 124], period: 5120, amplitude: 0.32, phase: 2.1 },
  { direction: [43, 39, 145], period: 2560, amplitude: 0.12, phase: 4.5 },
  { direction: [125, -68, 192], period: 1280, amplitude: 0.045, phase: 1.7 },
  { direction: [72, 59, 191], period: 640, amplitude: 0.016, phase: 5.2 },
  { direction: [143, 71, 179], period: 320, amplitude: 0.006, phase: 3.4 }
] as const
export const OCEAN_WARP_K: Vec3 = [1, 2, 1].map(v => (v * 2 * Math.PI) / 640) as Vec3
export const OCEAN_WARP_STRENGTH = 0.35
export const OCEAN_CREST_SHARPNESS = 0.2

const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v))
const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, v, i) => s + v * b[i], 0)
const normalize = (v: Vec3): Vec3 => v.map(x => x / Math.hypot(...v)) as Vec3
const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export interface OceanSurface {
  height: number
  gradient: Vec3
  normal: Vec3
  crest: number
  variance: number
}

/** Metres, seconds, body-local outward normal. Derivatives are analytic. */
export function sampleOceanSurface(
  position: Vec3, up: Vec3, time: number, footprint: number, strength: number
): OceanSurface {
  const normal = normalize(up)
  const gain = clamp(strength, 0, 3)
  if (gain === 0) return { height: 0, gradient: [0, 0, 0], normal, crest: 0, variance: 0 }
  const periodic = (period: number): Vec3 => position.map(v => ((v % period) + period) % period) as Vec3
  const warpPhase = dot(periodic(640), OCEAN_WARP_K) - time * 0.19
  const warp = Math.sin(warpPhase) * OCEAN_WARP_STRENGTH
  const warpGradient = OCEAN_WARP_K.map(v => v * Math.cos(warpPhase) * OCEAN_WARP_STRENGTH)
  let height = 0
  let amplitude = 0
  let variance = 0
  const gradient: Vec3 = [0, 0, 0]
  for (const wave of OCEAN_WAVES) {
    const k = wave.direction.map(v => (2 * Math.PI * v) / wave.period)
    const kLength = Math.hypot(...k)
    // Filter the second harmonic as well as the fundamental.
    const weight = octaveWeight(Math.PI / kLength, Math.max(footprint, 1e-6))
    const a = wave.amplitude * gain
    const phase = dot(periodic(wave.period), k) - Math.sqrt(9.81 * kLength) * time + wave.phase + warp
    height += a * weight * (Math.sin(phase) - OCEAN_CREST_SHARPNESS * Math.cos(2 * phase))
    amplitude += a * weight
    const derivative = a * weight * (Math.cos(phase) + 2 * OCEAN_CREST_SHARPNESS * Math.sin(2 * phase))
    for (let i = 0; i < 3; i++) gradient[i] += derivative * (k[i] + warpGradient[i])
    const tangentK2 = Math.max(0, kLength * kLength - dot(k, normal) ** 2)
    variance += (1 - weight * weight) * a * a * tangentK2 * (0.5 + 2 * OCEAN_CREST_SHARPNESS ** 2)
  }
  const radialGradient = dot(gradient, normal)
  for (let i = 0; i < 3; i++) gradient[i] -= normal[i] * radialGradient
  return {
    height,
    gradient,
    normal: normalize(normal.map((v, i) => v - gradient[i]) as Vec3),
    crest: amplitude > 0 ? smoothstep(0.55, 1.05, height / amplitude) * Math.min(gain, 1) : 0,
    variance
  }
}

export function oceanFresnel(mu: number): number {
  return WATER_GLINT_F0 + (1 - WATER_GLINT_F0) * (1 - clamp(mu)) ** 5
}

export function oceanLayerOpacity(depthAlpha: number, fresnel: number): number {
  return fresnel + (1 - fresnel) * depthAlpha
}

/** GGX distribution with height-correlated Smith visibility, including N·L. */
export function oceanSunGlint(noL: number, noV: number, noH: number, voH: number, alpha2: number): number {
  if (noL <= 0 || noV <= 0) return 0
  const a2 = clamp(alpha2, WATER_MIN_ALPHA2, 1)
  const d = noH * noH * (a2 - 1) + 1
  const distribution = a2 / (Math.PI * d * d)
  const visibility = 0.5 / Math.max(
    noL * Math.sqrt(noV * noV * (1 - a2) + a2) + noV * Math.sqrt(noL * noL * (1 - a2) + a2), 1e-8
  )
  return Math.min(WATER_GLINT_CEILING, distribution * visibility * oceanFresnel(voH) * noL)
}
