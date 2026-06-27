import { Color, Vector3 } from 'three'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export type NebulaShape = 'ellipsoid' | 'disk'
export type NebulaLOD = 'raymarch' | 'impostor' | 'auto'

export interface ColorStop {
  t: number // 0..1 position along density
  color: Color
}

export interface NebulaLobe {
  center: Vector3 // local space, components in [-1, 1]
  radius: number // local units
  weight: number // contribution multiplier
  seed: number
}

export interface NebulaCavity {
  center: Vector3 // local space
  radius: number
  strength: number // 0..1 carve amount
}

export interface NebulaParams {
  seed: number

  size: number // proxy half-extent, Three.js units
  shape: NebulaShape
  axisRatios: Vector3 // anisotropy (x,y,z)
  edgeFalloff: number

  lobes: NebulaLobe[]
  cavities: NebulaCavity[]
  noise: {
    octaves: number
    frequency: number
    lacunarity: number
    gain: number
    warpStrength: number
    ridged: number // 0..1 billow<->ridged mix
    contrast: number
  }

  palette: {
    stops: ColorStop[]
    secondary: Color
    secondaryThreshold: number
    emissiveIntensity: number
  }

  dust: {
    strength: number
    threshold: number
    color: Color
  }

  lighting: {
    starPosition: Vector3 | null // world space
    scatterStrength: number
    ambient: number
  }

  quality: {
    maxSteps: number
    resolutionScale: number
    forceLOD: NebulaLOD
    bake3DTexture: boolean
    bakeResolution: number
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function cloneNebulaParams(src: NebulaParams): NebulaParams {
  return {
    seed: src.seed,
    size: src.size,
    shape: src.shape,
    axisRatios: src.axisRatios.clone(),
    edgeFalloff: src.edgeFalloff,
    lobes: src.lobes.map((l) => ({ center: l.center.clone(), radius: l.radius, weight: l.weight, seed: l.seed })),
    cavities: src.cavities.map((c) => ({ center: c.center.clone(), radius: c.radius, strength: c.strength })),
    noise: { ...src.noise },
    palette: {
      stops: src.palette.stops.map((s) => ({ t: s.t, color: s.color.clone() })),
      secondary: src.palette.secondary.clone(),
      secondaryThreshold: src.palette.secondaryThreshold,
      emissiveIntensity: src.palette.emissiveIntensity
    },
    dust: { strength: src.dust.strength, threshold: src.dust.threshold, color: src.dust.color.clone() },
    lighting: {
      starPosition: src.lighting.starPosition ? src.lighting.starPosition.clone() : null,
      scatterStrength: src.lighting.scatterStrength,
      ambient: src.lighting.ambient
    },
    quality: { ...src.quality }
  }
}

export function makeDefaultNebulaParams(): NebulaParams {
  return {
    seed: 1337,
    size: 1000,
    shape: 'ellipsoid',
    axisRatios: new Vector3(1, 0.8, 1),
    edgeFalloff: 0.35,
    lobes: [],
    cavities: [],
    noise: {
      octaves: 5,
      frequency: 1.6,
      lacunarity: 2.0,
      gain: 0.5,
      warpStrength: 0.35,
      ridged: 0.4,
      contrast: 1.6
    },
    palette: {
      stops: [
        { t: 0.0, color: new Color(0x14062b) },
        { t: 0.45, color: new Color(0x6a1b9a) },
        { t: 0.8, color: new Color(0xff5577) },
        { t: 1.0, color: new Color(0xffd9a0) }
      ],
      secondary: new Color(0x35d0ff),
      secondaryThreshold: 0.6,
      emissiveIntensity: 1.6
    },
    dust: {
      strength: 0.6,
      threshold: 0.55,
      color: new Color(0x0a0608)
    },
    lighting: {
      starPosition: null,
      scatterStrength: 0.8,
      ambient: 0.25
    },
    quality: {
      // 64 keeps full-screen interior cost ~33% below 96; dithering hides the
      // extra banding. Raise again once per-step cost drops (3D-texture bake).
      maxSteps: 64,
      resolutionScale: 1,
      forceLOD: 'auto',
      bake3DTexture: false,
      bakeResolution: 128
    }
  }
}

export const DEFAULT_NEBULA_PARAMS: NebulaParams = makeDefaultNebulaParams()

export function mergeNebulaParams(
  overrides: DeepPartial<NebulaParams> = {},
  base: NebulaParams = makeDefaultNebulaParams()
): NebulaParams {
  const result = cloneNebulaParams(base)
  const o = overrides as Partial<NebulaParams>

  if (o.seed !== undefined) result.seed = o.seed
  if (o.size !== undefined) result.size = o.size
  if (o.shape !== undefined) result.shape = o.shape
  if (o.axisRatios) result.axisRatios.copy(o.axisRatios as Vector3)
  if (o.edgeFalloff !== undefined) result.edgeFalloff = o.edgeFalloff
  if (o.lobes) result.lobes = o.lobes as NebulaLobe[]
  if (o.cavities) result.cavities = o.cavities as NebulaCavity[]

  Object.assign(result.noise, overrides.noise)
  if (overrides.palette) {
    if (overrides.palette.stops) result.palette.stops = overrides.palette.stops as ColorStop[]
    if (overrides.palette.secondary) result.palette.secondary.copy(overrides.palette.secondary as Color)
    if (overrides.palette.secondaryThreshold !== undefined)
      result.palette.secondaryThreshold = overrides.palette.secondaryThreshold
    if (overrides.palette.emissiveIntensity !== undefined)
      result.palette.emissiveIntensity = overrides.palette.emissiveIntensity
  }
  if (overrides.dust) {
    if (overrides.dust.strength !== undefined) result.dust.strength = overrides.dust.strength
    if (overrides.dust.threshold !== undefined) result.dust.threshold = overrides.dust.threshold
    if (overrides.dust.color) result.dust.color.copy(overrides.dust.color as Color)
  }
  if (overrides.lighting) {
    if (overrides.lighting.starPosition !== undefined)
      result.lighting.starPosition = overrides.lighting.starPosition
        ? (overrides.lighting.starPosition as Vector3).clone()
        : null
    if (overrides.lighting.scatterStrength !== undefined)
      result.lighting.scatterStrength = overrides.lighting.scatterStrength
    if (overrides.lighting.ambient !== undefined) result.lighting.ambient = overrides.lighting.ambient
  }
  Object.assign(result.quality, overrides.quality)

  result.quality.resolutionScale = clamp(result.quality.resolutionScale, 0.25, 1)
  result.quality.bakeResolution = clamp(result.quality.bakeResolution, 64, 256)
  result.quality.maxSteps = clamp(Math.round(result.quality.maxSteps), 8, 256)

  return result
}
