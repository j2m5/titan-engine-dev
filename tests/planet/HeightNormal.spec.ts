import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { heightNormalFunctions, heightNormalUniforms } from '@/core/materials/shaders/lib/chunks/HeightNormal'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('HeightNormal: нормаль из карты высот аналитическим градиентом', () => {
  it('чанки зарегистрированы — иначе include молча раскроется в пустоту', () => {
    expect(AppShaderChunk.heightNormalFunctions).toBe(heightNormalFunctions)
    expect(AppShaderChunk.heightNormalUniforms).toBe(heightNormalUniforms)
  })

  it('четыре выборки центральными разностями с шагом в один тексель', () => {
    expect(heightNormalFunctions).toContain('uBumpTexelSize.x')
    expect(heightNormalFunctions).toContain('uBumpTexelSize.y')
    expect(heightNormalFunctions).toContain('hR - hL')
    expect(heightNormalFunctions).toContain('hU - hD')
  })

  it('шов по долготе заворачивается через fract — wrapS текстур не задан', () => {
    expect(heightNormalFunctions).toContain('fract(uv.x - uBumpTexelSize.x)')
    expect(heightNormalFunctions).toContain('fract(uv.x + uBumpTexelSize.x)')
  })

  it('у полюса тангенс вырожден — возвращается геометрическая нормаль', () => {
    expect(heightNormalFunctions).toContain('if (len < 1e-4) return surfNormal;')
  })

  it('экранная производная из шейдера планеты убрана', () => {
    expect(PlanetShaderTemplate.fragmentShader).not.toContain('dHdxy_fwd')
    expect(PlanetShaderTemplate.fragmentShader).not.toContain('perturbNormalArb')
    expect(PlanetShaderTemplate.fragmentShader).toContain('perturbNormalFromHeight(normal, vEast, vUv)')
  })

  it('vEast приходит из вершинника и не нормализован там (длина — детектор полюса)', () => {
    expect(PlanetShaderTemplate.vertexShader).toContain('varying vec3 vEast;')
    expect(PlanetShaderTemplate.vertexShader).toContain('vEast = normalMatrix * cross(vec3(0.0, 1.0, 0.0), position);')
  })

  it('юниформ шага текселя объявлен в шаблоне с нейтральным дефолтом', () => {
    expect(PlanetShaderTemplate.uniforms.uBumpTexelSize.value.x).toBe(0)
    expect(PlanetShaderTemplate.uniforms.uBumpTexelSize.value.y).toBe(0)
  })
})
