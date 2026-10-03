import { describe, expect, it } from 'vitest'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'

describe.each([
  ['сфера', SphereSurfaceShaderTemplate],
  ['рельеф', TerrainShaderTemplate]
])('%s: терминатор суши без двойного гашения', (_path, template) => {
  const frag: string = template.fragmentShader

  it('суша под landGate, облака своим светом слоя, огни гаснут под облаками, ночь под (1 − dayFactor)', () => {
    expect(frag).toContain('float landGate = mix(dayFactor, 1.0, uTerrainLambert);')
    expect(frag).toContain('vec3 day = cloudRadiance + dayColor * (1.0 - cloudAlphaSlant) * landGate;')
    expect(frag).toContain('vec3 finalColor = night * (1.0 - dayFactor) * (1.0 - cloudAlphaSlant) + day;')
  })

  it('легаси-формулы нет: одна сборка на оба пути', () => {
    expect(frag).not.toContain('mix(night, day, dayFactor)')
  })

  it('тинт суши — внутри dayColor и облаков, второго множителя на day нет', () => {
    const main = frag.slice(frag.indexOf('void main()'))
    expect((main.match(/sunTint\(muS\)/g) ?? []).length).toBe(1)
    expect(main).not.toMatch(/\bday \*=/)
    expect(main).toContain('night * (1.0 - dayFactor) * (1.0 - cloudAlphaSlant) + day')
  })
})
