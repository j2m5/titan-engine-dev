import { describe, expect, it } from 'vitest'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

function cloudBlock(frag: string): string {
  const start = frag.indexOf('#ifdef USE_CLOUD')
  const end = frag.indexOf('#endif', start)
  expect(start).toBeGreaterThan(0)
  return frag.slice(start, end)
}

/**
 * Облака лежат на высоте, нормаль рельефа (slope + детальный слой) к ним
 * отношения не имеет: склоны гор модулировали яркость облачного слоя.
 * Покрытие облаков — свойство текстуры, не освещения: альфа от уже
 * освещённого цвета истончала облака к терминатору (×0.56 при N·L = 0).
 */
describe('PlanetShaderTemplate: облака шейдятся геометрией сферы, покрытие — из текстуры', () => {
  const block = cloudBlock(PlanetShaderTemplate.fragmentShader)

  it('косинус облаков берётся от геометрической нормали vNormal, не от пертурбированной', () => {
    expect(block).toContain('dot(normalize(vNormal), lightDirection)')
    expect(block).not.toContain('lightIntensity')
  })

  it('альфа считается из сырой выборки cloudMap до освещения', () => {
    const sample = block.indexOf('texture2D(cloudMap, uv)')
    const alpha = block.indexOf('cloudAlpha = ')
    const lit = block.indexOf('cloudColor *= pow(')
    expect(sample).toBeGreaterThan(-1)
    expect(alpha).toBeGreaterThan(sample)
    expect(lit).toBeGreaterThan(alpha)
  })
})
