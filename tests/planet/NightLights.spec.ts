import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('Огни городов: порог и тинт вместо квадрата', () => {
  it('квадрата ночной карты больше нет', () => {
    expect(PlanetShaderTemplate.fragmentShader).not.toContain('nightColor * nightColor')
  })

  it('порог с мягкостью гасит слабую засветку', () => {
    const src = PlanetShaderTemplate.fragmentShader
    expect(src).toContain('smoothstep(uNightThreshold, uNightThreshold + uNightSoftness, nightLum)')
  })

  it('тинт по яркости: тусклые теплее, яркие белее', () => {
    expect(PlanetShaderTemplate.fragmentShader).toContain('vec3(1.0, 0.78, 0.45)')
    expect(PlanetShaderTemplate.fragmentShader).toContain('vec3(1.0, 0.97, 0.92)')
  })

  it('огни остаются под LDR-клампом — без HDR и блума', () => {
    const src = PlanetShaderTemplate.fragmentShader
    expect(src.indexOf('vec3 night =')).toBeLessThan(src.indexOf('clamp(finalColor, 0.0, 0.99)'))
    expect(src).not.toContain('night * 4.0')
  })

  it('ручки порога объявлены в шаблоне', () => {
    expect(PlanetShaderTemplate.uniforms.uNightThreshold.value).toBe(0.06)
    expect(PlanetShaderTemplate.uniforms.uNightSoftness.value).toBe(0.18)
  })
})
