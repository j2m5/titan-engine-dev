import { describe, expect, it } from 'vitest'
import { irradianceUv } from '@/core/materials/shaders/lib/chunks/sunTransmittanceMath'
import { sunTransmittanceFunctions, sunTransmittanceUniforms } from '@/core/materials/shaders/lib/chunks/SunTransmittance'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { atmosphereShader } from '@/core/renderables/Atmosphere/atmosphere'

/** Ключевые строки ядра — берутся из источника, чтобы порт не разъехался. */
function coreLine(regex: RegExp): string {
  const m = atmosphereShader.match(regex)
  expect(m, `в atmosphere.ts не найдено: ${regex}`).not.toBeNull()
  return m![0]
}

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
    // юниформный гейт: при 0 два тапа LUT не платятся
    expect(frag).toContain('if (uSkyAmbientStrength > 0.0) skyTerm = mix(skyTerm, skyAmbientTint(muS), uSkyAmbientStrength);')
    const idx = frag.indexOf('skyTerm = mix(skyTerm, skyAmbientTint')
    // гейт парный: uSkyAmbientStrength и skyAmbientTint живут в чанке под USE_SUN_TINT
    expect(frag.lastIndexOf('#if defined(USE_SKY_AMBIENT) && defined(USE_SUN_TINT)', idx)).toBeGreaterThan(frag.lastIndexOf('vec3 skyTerm = vec3(clamp(', idx))
  })

  it('суша: тинт солнца только на прямом свете и сером поле, не на небе и не на всём day', () => {
    const frag = PlanetShaderTemplate.fragmentShader
    expect(frag).toContain('vec3 skyTerm = vec3(clamp(sunElevation / max(uTerrainAmbientSunRef, 1e-3), 0.0, 1.0)) * sunTintMix;')
    expect(frag).toContain('vec3 lit = mix(ambient, vec3(directGain) * uLightColor * sunTintMix, max(NdotLraw, 0.0));')
    expect(frag).toContain('vec3 lit = mix(ambient, vec3(directGain) * sunTintMix, max(NdotLraw, 0.0));')
    expect(frag).toContain('dayColor = surfaceAlbedo * mix(sunTintMix, lit, uTerrainLambert);')
    expect(frag).toContain('vec3 day = cloudColor * sunTintMix * dayFactor + dayColor * (1.0 - cloudAlpha) * landGate;')
    // терраформная ветка day целиком не тонирует: единственный такой множитель — у легаси (#else)
    const terrainDay = frag.indexOf('vec3 day = cloudColor * sunTintMix * dayFactor')
    const legacyDay = frag.indexOf('vec3 day = cloudColor + dayColor * (1.0 - cloudAlpha);')
    expect(frag.slice(terrainDay, legacyDay)).not.toContain('sunTint(muS)')
  })

  it('порт формулы x_mu_s не разъехался с ядром Брунетона', () => {
    expect(coreLine(/Number x_mu_s = mu_s \* 0\.5 \+ 0\.5;/)).toBe('Number x_mu_s = mu_s * 0.5 + 0.5;')
    expect(sunTransmittanceFunctions).toContain('float xMuS = muS * 0.5 + 0.5;')
  })
})
