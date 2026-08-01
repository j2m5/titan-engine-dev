import { BrunetonAtmosphereShaderTemplate } from '@/core/renderables/Atmosphere/BrunetonAtmosphereShaderTemplate'

describe('Атмосфера: два выхода вместо скалярной альфы', () => {
  const src = BrunetonAtmosphereShaderTemplate.fragmentShader

  it('проход пропускания отделён дефайном', () => {
    expect(src).toContain('#ifdef ATMOSPHERE_PASS_TRANSMITTANCE')
  })

  it('юниформ переключения композиции объявлен с нейтральным дефолтом', () => {
    expect(src).toContain('uniform float uLegacyComposition')
    expect(BrunetonAtmosphereShaderTemplate.uniforms.uLegacyComposition.value).toBe(0)
  })

  it('проход пропускания отдаёт transmittance, в старом режиме — среднее', () => {
    expect(src).toContain('vec3 outTransmittance = mix(transmittance, vec3(meanT), uLegacyComposition);')
  })

  it('проход in-scatter отдаёт color, в старом режиме — гашеный альфой', () => {
    expect(src).toContain('vec3 outScatter = color * mix(1.0, alpha, uLegacyComposition);')
  })

  it('альфа выхода больше не несёт композицию — обе ветки пишут 1.0', () => {
    expect(src).toContain('fragColor = vec4(outTransmittance, 1.0);')
    expect(src).toContain('fragColor = vec4(outScatter, 1.0);')
    expect(src).not.toContain('fragColor = vec4(color, clamp(alpha, 0.0, 1.0));')
  })

  it('колено и потолок остались на in-scatter и не попали в пропускание', () => {
    const knee = src.indexOf('min(color, vec3(1.0)) + excess * uHdrKnee')
    const ceiling = src.indexOf('min(color, vec3(64.0))')
    const branch = src.indexOf('#ifdef ATMOSPHERE_PASS_TRANSMITTANCE')

    expect(knee).toBeGreaterThan(-1)
    expect(ceiling).toBeGreaterThan(-1)
    expect(knee).toBeLessThan(branch)
    expect(ceiling).toBeLessThan(branch)
  })

  it('запись глубины общая для обоих проходов — стоит после #endif', () => {
    const endif = src.lastIndexOf('#endif')
    const depthWrite = src.lastIndexOf('gl_FragDepth = vIsPerspective')

    expect(endif).toBeGreaterThan(-1)
    expect(depthWrite).toBeGreaterThan(endif)
  })
})
