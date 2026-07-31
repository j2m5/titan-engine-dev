import { BrunetonAtmosphereShaderTemplate } from '@/core/renderables/Atmosphere/BrunetonAtmosphereShaderTemplate'

describe('BrunetonAtmosphere: линейный HDR-выход (тонмап — в постобработке)', () => {
  const frag: string = BrunetonAtmosphereShaderTemplate.fragmentShader

  it('самотонмап 1-exp(...) убран из фрагментника', () => {
    // Кривая 1-e^-x давала бы двойной тонмаппинг поверх общего AgX
    expect(frag).not.toContain('exp(-radiance')
  })

  it('линейный выход, колено HDR-избытка и потолок 64 — в этом порядке', () => {
    const linearIdx: number = frag.indexOf('vec3 color = radiance / white_point * exposure;')
    const kneeIdx: number = frag.indexOf('color = min(color, vec3(1.0)) + excess * uHdrKnee;')
    const ceilIdx: number = frag.indexOf('color = min(color, vec3(64.0));')
    expect(linearIdx).toBeGreaterThan(-1)
    expect(kneeIdx).toBeGreaterThan(linearIdx)
    expect(ceilIdx).toBeGreaterThan(kneeIdx)
  })

  it('uHdrKnee объявлен юниформом с нейтральным дефолтом 1.0', () => {
    expect(frag).toContain('uniform float uHdrKnee;')
    expect(BrunetonAtmosphereShaderTemplate.uniforms.uHdrKnee.value).toBe(1.0)
    expect(frag).toContain('uniform float exposure;')
    expect(frag).toContain('uniform vec3 white_point;')
  })
})
