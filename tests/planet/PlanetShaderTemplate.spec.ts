import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('PlanetShaderTemplate: блик, терминатор, ночные огни', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader
  const vert: string = PlanetShaderTemplate.vertexShader

  it('старый камеро-независимый блик удалён', () => {
    expect(frag).not.toContain('pow(specComp, 32.0)')
    expect(frag).not.toContain('* 0.35')
  })

  it('Blinn-Phong + френель Шлика с гейтом освещённой стороны', () => {
    expect(frag).toContain('uniform float uSpecularStrength;')
    expect(frag).toContain('halfVec')
    expect(frag).toContain('pow(max(dot(normal, halfVec), 0.0), 64.0)')
    expect(frag).toContain('fresnel')
    expect(frag).toContain('uSpecularStrength')
    expect(frag).toContain('smoothstep(0.0, 0.15, NdotLraw)')
  })

  it('bloom-guard: диффуз-кламп 0.99 ДО блика, потолок глинта 4.0 после', () => {
    const clampIdx: number = frag.indexOf('clamp(finalColor, 0.0, 0.99)')
    const specIdx: number = frag.indexOf('* uSpecularStrength')
    const ceilIdx: number = frag.indexOf('min(finalColor, vec3(4.0))')
    expect(clampIdx).toBeGreaterThan(-1)
    expect(specIdx).toBeGreaterThan(clampIdx)
    expect(ceilIdx).toBeGreaterThan(specIdx)
  })

  it('терминатор: smoothstep-зона, закатный пояс, гейт ночных огней', () => {
    expect(frag).toContain('dayFactor')
    expect(frag).toContain('smoothstep(-0.08, 0.25, NdotLraw)')
    expect(frag).toContain('duskBand')
    expect(frag).toContain('vec3(1.0, 0.55, 0.35)')
    expect(frag).toContain('nightGate')
    expect(frag).toContain('1.0 - smoothstep(-0.05, 0.12, NdotLraw)')
  })

  it('тень кольца — единый множитель на диффуз и блик', () => {
    expect(frag).toContain('ringShadowFactor')
    expect(frag).not.toContain('#include <ringShadowFragment>')
  })

  it('рудимент USE_ATMOSPHERE удалён', () => {
    expect(vert).not.toContain('USE_ATMOSPHERE')
    expect(vert).not.toContain('vLocalCameraPosition')
    expect(frag).not.toContain('USE_ATMOSPHERE')
  })

  it('юниформ uSpecularStrength объявлен с дефолтом 2.0', () => {
    expect(PlanetShaderTemplate.uniforms.uSpecularStrength.value).toBe(2.0)
  })
})
