import { ringShadowFragment, ringShadowFunctions, ringShadowUniforms } from './RingShadow'
import { noiseFunctions } from './Noise'
import { bumpFunctions } from '@/core/materials/shaders/lib/chunks/Bump'
import { IUniform, Uniform } from 'three'
import { atmosphereFunctions, atmosphereFragment } from '@/core/materials/shaders/lib/chunks/Atmosphere'

export const AppUniformsChunk: Record<string, Record<string, IUniform>> = {
  ringShadowUniforms: {
    shadowRingsInnerRadius: new Uniform(0),
    shadowRingsOuterRadius: new Uniform(0),
    shadowRingsTexture: new Uniform(null)
  }
}

export const AppShaderChunk: Record<string, any> = {
  ringShadowUniforms,
  ringShadowFunctions,
  ringShadowFragment,
  noiseFunctions,
  bumpFunctions,
  atmosphereFunctions,
  atmosphereFragment
}
