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

  it('принимает sampler2D первым параметром — один бленд для любого набора карт', () => {
    expect(triplanarDetailFunctions).toContain('vec3 triplanarAlbedo(sampler2D map, vec3 p, vec3 w, vec2 offset)')
    expect(triplanarDetailFunctions).toContain('vec3 triplanarArm(sampler2D map, vec3 p, vec3 w, vec2 offset)')
    expect(triplanarDetailFunctions).toContain('vec3 triplanarNormal(sampler2D map, vec3 p, vec3 n, vec3 w, vec2 offset)')
  })

  it('тела функций больше не зашивают uRock*-самплеры жёстко', () => {
    expect(triplanarDetailFunctions).not.toContain('uRockDiffMap')
    expect(triplanarDetailFunctions).not.toContain('uRockNorMap')
    expect(triplanarDetailFunctions).not.toContain('uRockArmMap')
  })

  it('зарегистрирован в AppShaderChunk для #include', () => {
    expect(AppShaderChunk.triplanarDetailUniforms).toBe(triplanarDetailUniforms)
    expect(AppShaderChunk.triplanarDetailFunctions).toBe(triplanarDetailFunctions)
  })
})
