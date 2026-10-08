import { describe, it, expect } from 'vitest'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'

/**
 * Френель Шлика — pow(1 − cosθ, 5). Скалярное произведение нормализованных
 * векторов округляется выше 1 (V почти вдоль N, float32), и с одним нижним
 * клампом max(…, 0) основание степени уходит в минус: pow даёт NaN на
 * ANGLE/D3D, а блум размазывает пиксель в пятно. Блик льда это уже чинил —
 * страж держит все места.
 */
const unboundedFresnel: RegExp = /pow\(\s*\(?\s*1\.0\s*-\s*max\(\s*dot\(/

describe('Френель: основание степени не выходит за [0, 1]', () => {
  it.each([
    ['вода', WaterShaderTemplate.fragmentShader],
    ['рельеф', TerrainShaderTemplate.fragmentShader]
  ])('%s — нет pow(1 − max(dot(…), 0), …) без верхнего клампа', (_name: string, source: string) => {
    expect(source).not.toMatch(unboundedFresnel)
  })

  it('волны воды: косинус для Френеля зажат с обеих сторон', () => {
    expect(WaterShaderTemplate.fragmentShader).toContain('float waveTheta = clamp(dot(viewDir, waveNormal), 0.0, 1.0);')
  })
})
