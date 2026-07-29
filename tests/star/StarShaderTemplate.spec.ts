import { StarShaderTemplate } from '@/core/materials/shaders/lib/StarShaderTemplate'

describe('StarShaderTemplate: HDR-поверхность с чёрнотельной палитрой', () => {
  const frag: string = StarShaderTemplate.fragmentShader
  const vert: string = StarShaderTemplate.vertexShader

  it('инвертированные lighten/darken удалены', () => {
    expect(frag).not.toContain('lighten(')
    expect(frag).not.toContain('darken(')
  })

  it('хак «яркость от дистанции» удалён', () => {
    expect(frag).not.toContain('0.003')
  })

  it('чёрнотельная палитра и HDR-ядро', () => {
    expect(frag).toContain('uColorCool')
    expect(frag).toContain('uColorHot')
    expect(frag).toContain('uCoreIntensity')
  })

  it('потолок HDR — тот же инвариант, что у атмосферы', () => {
    expect(frag).toContain('min(granule * energy * limb, vec3(64.0))')
  })

  it('лимбовое потемнение: uLimbCoeff в фрагменте, vCenterW из вершинника', () => {
    expect(frag).toContain('uLimbCoeff')
    expect(vert).toContain('vCenterW')
  })

  it('fbm грануляции сохранён (6 октав, persistence 0.9, домен 0.05)', () => {
    expect(frag).toContain('fbm(')
    expect(frag).toContain('vPosition * 0.05')
    expect(frag).toContain('6, 0.9')
  })
})
