import { describe, expect, it } from 'vitest'
import { cloudLayerFunctions } from '@/core/materials/shaders/lib/chunks/CloudLayer'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'

function cloudBlock(frag: string): string {
  // '\n' обязателен: USE_CLOUD_SHADOW (тень облаков на земле) стоит в шейдере
  // ВЫШЕ и матчился бы префиксом — блок уехал бы не туда
  // ищем в main(): выше такой же гейт стоит у подключения чанка
  const start = frag.indexOf('#ifdef USE_CLOUD\n', frag.indexOf('void main()'))
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
describe.each([
  ['сфера', SphereSurfaceShaderTemplate],
  ['рельеф', TerrainShaderTemplate]
])('%s: облака шейдятся геометрией сферы, покрытие — из текстуры', (_path, template) => {
  const block = cloudBlock(template.fragmentShader)

  it('свет облаков — в точке слоя по её радиусу (cloudDir), не от нормали рельефа', () => {
    expect(block).toContain('cloudLitRadiance(cloudPremul, cloudDir, -normalize(vLocalLightDirection))')
    expect(block).not.toContain('vNormal')
    expect(block).not.toContain('lightIntensity')
  })

  it('альфа считается из сырой выборки cloudMap до освещения', () => {
    // выборка и покрытие — внутри cloudLayerSample, свет считается после неё из премультиплицированного цвета
    const sample = block.indexOf('cloudLayerSample(')
    const lit = block.indexOf('cloudLitRadiance(')
    expect(sample).toBeGreaterThan(-1)
    expect(lit).toBeGreaterThan(sample)
    expect(cloudLayerFunctions).toContain('texture2D(cloudMap, terrainUv(cloudDir)).rgb')
  })
})
