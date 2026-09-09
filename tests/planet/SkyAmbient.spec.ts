import { describe, expect, it } from 'vitest'
import { irradianceUv } from '@/core/materials/shaders/lib/chunks/sunTransmittanceMath'
import { sunTransmittanceFunctions, sunTransmittanceUniforms } from '@/core/materials/shaders/lib/chunks/SunTransmittance'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('irradianceUv: порт GetIrradianceTextureUvFromRMuS', () => {
  it('x = μ_s·0.5+0.5, y = (r−bottom)/(top−bottom), полутексельные отступы 64×16', () => {
    const uv = irradianceUv(6360, 1, 6360, 6420, 64, 16)
    expect(uv.u).toBeCloseTo(0.5 / 64 + 1 * (1 - 1 / 64), 12)
    expect(uv.v).toBeCloseTo(0.5 / 16, 12)
    expect(irradianceUv(6390, -1, 6360, 6420, 64, 16).u).toBeCloseTo(0.5 / 64, 12)
    expect(irradianceUv(6390, 0, 6360, 6420, 64, 16).v).toBeCloseTo(0.5 / 16 + 0.5 * (1 - 1 / 16), 12)
  })

  it('r вне оболочки клампится к [bottom, top]', () => {
    expect(irradianceUv(6000, 0, 6360, 6420, 64, 16).v).toBeCloseTo(0.5 / 16, 12)
    expect(irradianceUv(7000, 0, 6360, 6420, 64, 16).v).toBeCloseTo(0.5 / 16 + 1 - 1 / 16, 12)
  })
})

describe('Небесный амбиент: irradiance-LUT в чанке SunTransmittance', () => {
  it('юниформы и функции объявлены, размеры LUT 64×16 из генератора', () => {
    expect(sunTransmittanceUniforms).toContain('uniform sampler2D uAtmoIrradiance;')
    expect(sunTransmittanceUniforms).toContain('uniform float uSkyAmbientStrength;')
    expect(sunTransmittanceFunctions).toContain('const int ATMO_IRRADIANCE_W = 64;')
    expect(sunTransmittanceFunctions).toContain('const int ATMO_IRRADIANCE_H = 16;')
    expect(sunTransmittanceFunctions).toContain('float xMuS = muS * 0.5 + 0.5;')
    expect(sunTransmittanceFunctions).toContain('return clamp(e / lum, 0.0, 4.0);')
  })

  it('шаблон смешивает серый пол с небом под USE_SKY_AMBIENT весом uSkyAmbientStrength', () => {
    const frag = PlanetShaderTemplate.fragmentShader
    expect(frag).toContain('skyTerm = mix(skyTerm, skyAmbientTint(muS), uSkyAmbientStrength);')
    const idx = frag.indexOf('skyTerm = mix(skyTerm, skyAmbientTint')
    expect(frag.lastIndexOf('#ifdef USE_SKY_AMBIENT', idx)).toBeGreaterThan(frag.lastIndexOf('vec3 skyTerm = vec3(clamp(', idx))
  })
})
