import { BrunetonAtmosphereShaderTemplate } from '@/core/renderables/Atmosphere/BrunetonAtmosphereShaderTemplate'

describe('BrunetonAtmosphere: линейный HDR-выход (тонмап — в постобработке)', () => {
  const frag: string = BrunetonAtmosphereShaderTemplate.fragmentShader

  it('самотонмап 1-exp(...) убран из фрагментника', () => {
    // Кривая 1-e^-x давала бы двойной тонмаппинг поверх общего AgX
    expect(frag).not.toContain('exp(-radiance')
  })

  it('radiance отдаётся линейно (с HDR-потолком) через прежние калибровочные юниформы', () => {
    expect(frag).toContain('vec3 color = min(radiance / white_point * exposure, vec3(64.0));')
    expect(frag).toContain('uniform float exposure;')
    expect(frag).toContain('uniform vec3 white_point;')
  })
})
