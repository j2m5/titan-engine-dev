import { ringShadowFragment, ringShadowFunctions, ringShadowUniforms } from './RingShadow'
import { noiseFunctions } from './Noise'
import { starSurface } from './StarSurface'
import { brownDwarfSurface } from './BrownDwarfSurface'
import { whiteDwarfSurface } from './WhiteDwarfSurface'
import { asteroidShapeFunctions } from './AsteroidShape'
import { asteroidSurfaceFunctions } from './AsteroidSurface'
import { heightNormalFunctions, heightNormalUniforms } from '@/core/materials/shaders/lib/chunks/HeightNormal'
import { slopeNormalFunctions } from '@/core/materials/shaders/lib/chunks/SlopeNormal'
import { ringDustFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'
import { triplanarDetailFunctions, triplanarDetailUniforms } from '@/core/materials/shaders/lib/chunks/TriplanarDetail'
import { terrainDetailFunctions, terrainDetailUniforms } from '@/core/materials/shaders/lib/chunks/TerrainDetail'
import { skyboxSampleFunctions, skyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import { IUniform, Uniform } from 'three'

export const AppUniformsChunk: Record<string, Record<string, IUniform>> = {
  ringShadowUniforms: {
    shadowRingsInnerRadius: new Uniform(0),
    shadowRingsOuterRadius: new Uniform(0),
    shadowRingsTexture: new Uniform(null)
  }
}

export const AppShaderChunk: Record<string, string> = {
  ringShadowUniforms,
  ringShadowFunctions,
  ringShadowFragment,
  noiseFunctions,
  starSurface,
  brownDwarfSurface,
  whiteDwarfSurface,
  asteroidShapeFunctions,
  asteroidSurfaceFunctions,
  heightNormalUniforms,
  heightNormalFunctions,
  slopeNormalFunctions,
  ringDustUniforms,
  ringDustFunctions,
  triplanarDetailUniforms,
  triplanarDetailFunctions,
  terrainDetailUniforms,
  terrainDetailFunctions,
  skyboxSampleUniforms,
  skyboxSampleFunctions
}
