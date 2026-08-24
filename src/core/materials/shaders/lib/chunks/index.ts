import { ringShadowFragment, ringShadowFunctions, ringShadowUniforms } from './RingShadow'
import { noiseFunctions } from './Noise'
import { starSurface } from './StarSurface'
import { brownDwarfSurface } from './BrownDwarfSurface'
import { whiteDwarfSurface } from './WhiteDwarfSurface'
import { asteroidShapeFunctions } from './AsteroidShape'
import { asteroidSurfaceFunctions } from './AsteroidSurface'
import { slopeNormalFunctions, slopeNormalUniforms } from '@/core/materials/shaders/lib/chunks/SlopeNormal'
import { terrainUvFunctions } from '@/core/materials/shaders/lib/chunks/TerrainUv'
import { ringDustFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'
import { triplanarDetailFunctions, triplanarDetailUniforms } from '@/core/materials/shaders/lib/chunks/TriplanarDetail'
import { terrainDetailFunctions, terrainDetailUniforms } from '@/core/materials/shaders/lib/chunks/TerrainDetail'
import { skyboxSampleFunctions, skyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import { sunTransmittanceFunctions, sunTransmittanceUniforms } from '@/core/materials/shaders/lib/chunks/SunTransmittance'
import { giantDetailFunctions, giantDetailUniforms } from '@/core/materials/shaders/lib/chunks/GiantDetail'
import { terrainMacroDetailFunctions, terrainMacroDetailUniforms } from '@/core/materials/shaders/lib/chunks/TerrainMacroDetail'
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
  slopeNormalUniforms,
  slopeNormalFunctions,
  terrainUvFunctions,
  ringDustUniforms,
  ringDustFunctions,
  triplanarDetailUniforms,
  triplanarDetailFunctions,
  terrainDetailUniforms,
  terrainDetailFunctions,
  skyboxSampleUniforms,
  skyboxSampleFunctions,
  sunTransmittanceUniforms,
  sunTransmittanceFunctions,
  giantDetailUniforms,
  giantDetailFunctions,
  terrainMacroDetailUniforms,
  terrainMacroDetailFunctions
}
