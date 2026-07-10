import { triplanarDetailFunctions, triplanarDetailUniforms } from '@/core/materials/shaders/lib/chunks/TriplanarDetail'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

describe('TriplanarDetail GLSL chunk', () => {
  it('объявляет юниформы микрослоя', () => {
    for (const name of [
      'uRockDiffMap', 'uRockNorMap', 'uRockArmMap', 'uDetailMapsEnabled',
      'uDetailScale', 'uDetailSaturation', 'uDetailBrightness',
      'uDetailNormalScale', 'uDetailAoInfluence', 'uDetailRoughInfluence'
    ]) {
      expect(triplanarDetailUniforms).toContain(name)
    }
  })

  it('определяет функции выборки', () => {
    for (const fn of ['triplanarWeights', 'triplanarAlbedo', 'triplanarArm', 'triplanarNormal']) {
      expect(triplanarDetailFunctions).toContain(fn)
    }
  })

  it('зарегистрирован в AppShaderChunk для #include', () => {
    expect(AppShaderChunk.triplanarDetailUniforms).toBe(triplanarDetailUniforms)
    expect(AppShaderChunk.triplanarDetailFunctions).toBe(triplanarDetailFunctions)
  })
})
