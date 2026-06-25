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
      maxSteps: 96,
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
  const o = overrides as Partial<NebulaParams>

  if (o.seed !== undefined) base.seed = o.seed
  if (o.size !== undefined) base.size = o.size
  if (o.shape !== undefined) base.shape = o.shape
  if (o.axisRatios) base.axisRatios.copy(o.axisRatios as Vector3)
  if (o.edgeFalloff !== undefined) base.edgeFalloff = o.edgeFalloff
  if (o.lobes) base.lobes = o.lobes as NebulaLobe[]
  if (o.cavities) base.cavities = o.cavities as NebulaCavity[]

  Object.assign(base.noise, overrides.noise)
  if (overrides.palette) {
    if (overrides.palette.stops) base.palette.stops = overrides.palette.stops as ColorStop[]
    if (overrides.palette.secondary) base.palette.secondary.copy(overrides.palette.secondary as Color)
    if (overrides.palette.secondaryThreshold !== undefined)
      base.palette.secondaryThreshold = overrides.palette.secondaryThreshold
    if (overrides.palette.emissiveIntensity !== undefined)
      base.palette.emissiveIntensity = overrides.palette.emissiveIntensity
  }
  if (overrides.dust) {
    if (overrides.dust.strength !== undefined) base.dust.strength = overrides.dust.strength
    if (overrides.dust.threshold !== undefined) base.dust.threshold = overrides.dust.threshold
    if (overrides.dust.color) base.dust.color.copy(overrides.dust.color as Color)
  }
  if (overrides.lighting) {
    if (overrides.lighting.starPosition !== undefined)
      base.lighting.starPosition = overrides.lighting.starPosition
        ? (overrides.lighting.starPosition as Vector3).clone()
        : null
    if (overrides.lighting.scatterStrength !== undefined)
      base.lighting.scatterStrength = overrides.lighting.scatterStrength
    if (overrides.lighting.ambient !== undefined) base.lighting.ambient = overrides.lighting.ambient
  }
  Object.assign(base.quality, overrides.quality)

  base.quality.resolutionScale = clamp(base.quality.resolutionScale, 0.25, 1)
  base.quality.bakeResolution = clamp(base.quality.bakeResolution, 64, 256)
  base.quality.maxSteps = clamp(Math.round(base.quality.maxSteps), 8, 256)

  return base
}
