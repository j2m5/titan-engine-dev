import { ringShadowFragment, ringShadowFunctions, ringShadowUniforms } from './RingShadow'
import { noiseFunctions } from './Noise'
import { asteroidShapeFunctions } from './AsteroidShape'
import { asteroidSurfaceFunctions } from './AsteroidSurface'
import { bumpFunctions } from '@/core/materials/shaders/lib/chunks/Bump'
import { ringDustFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'
import { triplanarDetailFunctions, triplanarDetailUniforms } from '@/core/materials/shaders/lib/chunks/TriplanarDetail'
import { IUniform, Uniform } from 'three'

export const AppUniformsChunk: Record<string, Record<string, IUniform>> = {
  ringShadowUniforms: {
    shadowRingsInnerRadius: new Uniform(0),
    shadowRingsOuterRadius: new Uniform(0),
    shadowRingsTexture: new Uniform(null)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AppShaderChunk: Record<string, any> = {
  ringShadowUniforms,
  ringShadowFunctions,
  ringShadowFragment,
  noiseFunctions,
  asteroidShapeFunctions,
  asteroidSurfaceFunctions,
  bumpFunctions,
  ringDustUniforms,
  ringDustFunctions,
  triplanarDetailUniforms,
  triplanarDetailFunctions
}
