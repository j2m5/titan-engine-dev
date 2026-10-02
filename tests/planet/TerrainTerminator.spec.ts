import { describe, expect, it } from 'vitest'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('PlanetShaderTemplate: терминатор суши без двойного гашения', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader

  it('терраформная ветка: суша под landGate, облака под dayFactor, ночь под (1 − dayFactor)', () => {
    expect(frag).toContain('float landGate = mix(dayFactor, 1.0, uTerrainLambert);')
    expect(frag).toContain('vec3 day = cloudColor * sunTintMix * dayFactor + dayColor * (1.0 - cloudAlpha) * landGate;')
    expect(frag).toContain('vec3 finalColor = night * (1.0 - dayFactor) + day;')
  })

  it('легаси-формулы нет: одна сборка на обе ветки', () => {
    expect(frag).not.toContain('vec3 day = cloudColor + dayColor * (1.0 - cloudAlpha);')
    expect(frag).not.toContain('mix(night, day, dayFactor)')
  })

  it('тинт суши — внутри dayColor и облаков, второго множителя на day нет', () => {
    const main = frag.slice(frag.indexOf('void main()'))
    expect((main.match(/sunTint\(muS\)/g) ?? []).length).toBe(1)
    expect(main).not.toMatch(/\bday \*=/)
    expect(main).toContain('night * (1.0 - dayFactor) + day')
  })
})
