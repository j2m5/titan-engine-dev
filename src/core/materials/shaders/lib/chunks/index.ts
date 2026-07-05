import { ringShadowFragment, ringShadowFunctions, ringShadowUniforms } from './RingShadow'
import { noiseFunctions } from './Noise'
import { asteroidShapeFunctions } from './AsteroidShape'
import { asteroidSurfaceFunctions } from './AsteroidSurface'
import { bumpFunctions } from '@/core/materials/shaders/lib/chunks/Bump'
import { ringDustFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'
import { IUniform, Uniform } from 'three'

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
  asteroidShapeFunctions,
  asteroidSurfaceFunctions,
  bumpFunctions,
  ringDustUniforms,
  ringDustFunctions
}
