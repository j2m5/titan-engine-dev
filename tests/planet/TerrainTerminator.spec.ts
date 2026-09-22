import { describe, expect, it } from 'vitest'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('PlanetShaderTemplate: терминатор суши без двойного гашения', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader

  it('терраформная ветка: суша под landGate, облака под dayFactor, ночь под (1 − dayFactor)', () => {
    expect(frag).toContain('float landGate = mix(dayFactor, 1.0, uTerrainLambert);')
    expect(frag).toContain('vec3 day = cloudColor * dayFactor + dayColor * (1.0 - cloudAlpha) * landGate;')
    expect(frag).toContain('vec3 finalColor = night * (1.0 - dayFactor) + day;')
  })

  it('легаси-ветка бит-в-бит: mix(night, day, dayFactor) с day = cloudColor + dayColor·(1−α)', () => {
    expect(frag).toContain('vec3 day = cloudColor + dayColor * (1.0 - cloudAlpha);')
    expect(frag).toContain('vec3 finalColor = mix(night, day, dayFactor);')
  })

  it('обе ветки под одним #ifdef USE_TERRAIN_UV / #else, тинт в каждой', () => {
    const start = frag.indexOf('float landGate')
    const elseIdx = frag.indexOf('#else', start)
    // #else несёт два вложенных #ifdef/#endif (USE_SUN_TINT, USE_LIGHT_TINT) —
    // первые два #endif после elseIdx закрывают их, не внешний USE_TERRAIN_UV; берём третий
    const innerEndif1 = frag.indexOf('#endif', elseIdx)
    const innerEndif2 = frag.indexOf('#endif', innerEndif1 + 1)
    const endIdx = frag.indexOf('#endif', innerEndif2 + 1)
    const terrain = frag.slice(frag.lastIndexOf('#ifdef USE_TERRAIN_UV', start), elseIdx)
    const legacy = frag.slice(elseIdx, endIdx)
    expect((terrain.match(/sunTint\(muS\)/g) ?? []).length).toBe(1)
    expect((legacy.match(/sunTint\(muS\)/g) ?? []).length).toBe(1)
    expect(terrain).toContain('night * (1.0 - dayFactor) + day')
    expect(legacy).toContain('mix(night, day, dayFactor)')
  })
})
