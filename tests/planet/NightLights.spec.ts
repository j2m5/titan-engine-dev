import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'

describe.each([
  ['сфера', SphereSurfaceShaderTemplate],
  ['рельеф', TerrainShaderTemplate]
])('Огни городов (%s): порог и тинт вместо квадрата', (_path, template) => {
  it('квадрата ночной карты больше нет', () => {
    expect(template.fragmentShader).not.toContain('nightColor * nightColor')
  })

  it('порог с мягкостью гасит слабую засветку', () => {
    const src = template.fragmentShader
    expect(src).toContain('smoothstep(uNightThreshold, uNightThreshold + uNightSoftness, nightLum)')
  })

  it('тинт по яркости: тусклые теплее, яркие белее', () => {
    expect(template.fragmentShader).toContain('vec3(1.0, 0.78, 0.45)')
    expect(template.fragmentShader).toContain('vec3(1.0, 0.97, 0.92)')
  })

  it('огни остаются под LDR-клампом — без HDR и блума', () => {
    const src = template.fragmentShader
    expect(src.indexOf('vec3 night =')).toBeLessThan(src.indexOf('clamp(finalColor, 0.0, 0.99)'))
    expect(src).not.toContain('night * 4.0')
  })

  it('ручки порога объявлены в шаблоне', () => {
    expect(template.uniforms.uNightThreshold.value).toBe(0.06)
    expect(template.uniforms.uNightSoftness.value).toBe(0.18)
  })
})
