import { ringShadowFragment, ringShadowFunctions, ringShadowUniforms } from './RingShadow'
import { noiseFunctions } from './Noise'
import { starSurface } from './StarSurface'
import { asteroidShapeFunctions } from './AsteroidShape'
import { asteroidSurfaceFunctions } from './AsteroidSurface'
import { heightNormalFunctions, heightNormalUniforms } from '@/core/materials/shaders/lib/chunks/HeightNormal'
import { ringDustFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'
import { triplanarDetailFunctions, triplanarDetailUniforms } from '@/core/materials/shaders/lib/chunks/TriplanarDetail'
import { skyboxSampleFunctions, skyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
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
  starSurface,
  asteroidShapeFunctions,
  asteroidSurfaceFunctions,
  heightNormalUniforms,
  heightNormalFunctions,
  ringDustUniforms,
  ringDustFunctions,
  triplanarDetailUniforms,
  triplanarDetailFunctions,
  skyboxSampleUniforms,
  skyboxSampleFunctions
}
