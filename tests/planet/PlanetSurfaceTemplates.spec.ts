import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'

const templates = [
  ['сфера', SphereSurfaceShaderTemplate],
  ['рельеф', TerrainShaderTemplate]
] as const

describe('SphereSurfaceShaderTemplate: блик воды на сфере', () => {
  const frag: string = SphereSurfaceShaderTemplate.fragmentShader

  it('Blinn-Phong + френель Шлика с гейтом освещённой стороны', () => {
    expect(frag).toContain('halfVec')
    expect(frag).toContain('pow(max(dot(normal, halfVec), 0.0), 64.0)')
    expect(frag).toContain('fresnel')
    expect(frag).toContain('* uWaterGlintGain')
    expect(frag).toContain('smoothstep(0.0, 0.15, NdotLraw)')
  })

  it('bloom-guard: диффуз-кламп 0.99 ДО блика, потолок глинта 4.0 после', () => {
    const clampIdx: number = frag.indexOf('clamp(finalColor, 0.0, 0.99)')
    const specIdx: number = frag.indexOf('* uWaterGlintGain')
    const ceilIdx: number = frag.indexOf('min(finalColor, vec3(4.0))')
    expect(clampIdx).toBeGreaterThan(-1)
    expect(specIdx).toBeGreaterThan(clampIdx)
    expect(ceilIdx).toBeGreaterThan(specIdx)
  })

  it('uSpecularStrength удалён: силу блика держит uWaterGlintGain (дефолт 1)', () => {
    expect(SphereSurfaceShaderTemplate.uniforms.uSpecularStrength).toBeUndefined()
    expect(SphereSurfaceShaderTemplate.uniforms.uWaterGlintGain.value).toBe(1)
  })
})

describe.each(templates)('%s: блики, терминатор, ночные огни', (_path, template) => {
  const frag: string = template.fragmentShader
  const vert: string = template.vertexShader

  it('старый камеро-независимый блик удалён', () => {
    expect(frag).not.toContain('pow(specComp, 32.0)')
  })

  it('bloom-guard: диффуз-кламп 0.99 до потолка глинта 4.0', () => {
    const clampIdx: number = frag.indexOf('clamp(finalColor, 0.0, 0.99)')
    const ceilIdx: number = frag.indexOf('min(finalColor, vec3(4.0))')
    expect(clampIdx).toBeGreaterThan(-1)
    expect(ceilIdx).toBeGreaterThan(clampIdx)
  })

  it('терминатор: smoothstep-зона и гейт ночных огней; закатный тинт удалён', () => {
    expect(frag).toContain('dayFactor')
    expect(frag).toContain('smoothstep(-0.08, 0.25, terminatorNdotL)')
    // Тинт на поверхности нефизичен для безатмосферных тел; покраснение
    // заката у атмосферных планет даёт рассеяние слоя Брюнетона
    expect(frag).not.toContain('duskBand')
    expect(frag).not.toContain('vec3(1.0, 0.55, 0.35)')
    expect(frag).toContain('nightGate')
    expect(frag).toContain('1.0 - smoothstep(-0.05, 0.12, terminatorNdotL)')
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

  it('uSpecularStrength в шаблоне нет', () => {
    expect(template.uniforms.uSpecularStrength).toBeUndefined()
  })
})
