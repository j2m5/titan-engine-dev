import { StarOuterLayerShaderTemplate } from '@/core/materials/shaders/lib/StarOuterLayerShaderTemplate'

describe('StarOuterLayerShaderTemplate: палитра протуберанцев от спектра звезды', () => {
  const vert: string = StarOuterLayerShaderTemplate.vertexShader
  const uniforms = StarOuterLayerShaderTemplate.uniforms

  it('радужная hue-палитра удалена', () => {
    expect(vert).not.toContain('#define hue')
    expect(vert).not.toContain('uHue')
  })

  it('цвет — интерполяция чёрнотельной палитры с HDR-интенсивностью', () => {
    expect(vert).toContain('mix(uColorCool, uColorBase, aWireRandom.w)')
    expect(vert).toContain('uProtuberanceIntensity')
  })

  it('юниформы палитры объявлены, hue-юниформы удалены', () => {
    expect(uniforms.uColorCool).toBeDefined()
    expect(uniforms.uColorBase).toBeDefined()
    expect(uniforms.uProtuberanceIntensity.value).toBe(6.0)
    expect(uniforms.uHue).toBeUndefined()
    expect(uniforms.uHueSpread).toBeUndefined()
  })
})
