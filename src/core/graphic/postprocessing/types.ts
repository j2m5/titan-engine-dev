import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { Vector2 } from 'three'

export type ToneMappingOptions = {
  blendFunction?: BlendFunction
  adaptive?: boolean
  mode?: ToneMappingMode
  resolution?: number
  maxLuminance?: number
  whitePoint?: number
  middleGrey?: number
  minLuminance?: number
  averageLuminance?: number
  adaptationRate?: number
}

export type ChromaticAberrationOptions = {
  blendFunction?: BlendFunction
  offset?: Vector2
  radialModulation: boolean
  modulationOffset: number
}

export type ZoomBlurEffectOptions = {
  blendFunction?: BlendFunction
  strength?: number
}

export type LensFlareEffectOptions = {
  blendFunction?: BlendFunction
  resolution: Vector2
  threshold: number
}
