import { BlackHoleShaderTemplate } from '@/core/renderables/BlackHole/BlackHoleShaderTemplate'
import { blackHole } from '@/config/blackHole'

/**
 * Константы разбираются из текста шейдера, а не дублируются числом здесь:
 * тест обязан ловить рассинхрон, а не повторять его.
 */
function shaderConstant(name: string): number {
  const source = BlackHoleShaderTemplate.fragmentShader
  const match = source.match(new RegExp(`const\\s+(?:int|float)\\s+${name}\\s*=\\s*([0-9.]+)`))

  if (!match) throw new Error(`Константа ${name} не найдена в шейдере ЧД`)

  return Number(match[1])
}

describe('Интегратор ЧД: бюджет шагов — предохранитель, а не ограничитель', () => {
  it('константы разбираются из шейдера', () => {
    expect(shaderConstant('MAX_STEPS')).toBeGreaterThan(0)
    expect(shaderConstant('PHI_MAX')).toBeGreaterThan(0)
  })

  it('шага хватает, чтобы дойти до предела навивки при шиппинговом dphi', () => {
    const stepsNeeded = shaderConstant('PHI_MAX') / blackHole.blackHole.integrationDphi

    expect(stepsNeeded).toBeLessThanOrEqual(shaderConstant('MAX_STEPS'))
  })

  it('остаётся запас на уточнение шага и подъём навивки', () => {
    // 6π при dphi 0.05 = 377 шагов: диапазон, который арка собирается пробовать
    const worstCase = 6 * Math.PI / blackHole.blackHole.integrationDphi

    expect(shaderConstant('MAX_STEPS')).toBeGreaterThanOrEqual(worstCase)
  })
})
