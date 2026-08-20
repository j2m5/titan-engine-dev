import { StarShaderTemplate } from '@/core/materials/shaders/lib/StarShaderTemplate'

describe('StarShaderTemplate: HDR-поверхность с чёрнотельной палитрой', () => {
  const frag: string = StarShaderTemplate.fragmentShader
  const vert: string = StarShaderTemplate.vertexShader

  it('инвертированные lighten/darken удалены', () => {
    expect(frag).not.toContain('lighten(')
    expect(frag).not.toContain('darken(')
  })

  it('хак «яркость от дистанции» удалён', () => {
    expect(frag).not.toContain('noiseIntensity')
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

  it('грануляция через общий чанк: include на месте, домен 0.05 в шаблоне', () => {
    // Октавы/persistence/ремап пинует tests/star/StarSurfaceChunk.spec.ts —
    // формулы теперь живут в чанке, общем с импостором
    expect(frag).toContain('#include <starSurface>')
    expect(frag).toContain('starGranulationT(')
    expect(frag).toContain('vPosition * 0.05')
  })

  it('собственного дубля формул нет — fbm и ремап живут только в чанке', () => {
    expect(frag).not.toContain('float fbm(')
    expect(frag).not.toContain('0.5 + fbm(')
  })
})

describe('StarShaderTemplate: зерно гаснет с расстоянием', () => {
  const frag: string = StarShaderTemplate.fragmentShader

  it('диск меряет экранный масштаб домена и подаёт фейд в грануляцию', () => {
    // Один домен на измерение и на сэмпл: разойдясь, они дали бы фейд не от
    // того масштаба, что рисуется
    expect(frag).toContain('vec3 noiseDomain = vPosition * 0.05;')
    expect(frag).toContain('starGranulationFade(starDomainPerPixel(noiseDomain))')
    expect(frag).toContain('starGranulationT(vec4(noiseDomain, time), fade)')
  })

  it('яркость от дистанции не вернулась: гаснет только зерно', () => {
    // Прежний хак поднимал цвет с расстоянием и выжигал диск в белое
    expect(frag).not.toContain('noiseIntensity')
    expect(frag).toContain('min(granule * energy * limb, vec3(64.0))')
  })
})
