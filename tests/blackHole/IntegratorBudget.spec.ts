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
    // stepsNeeded — непрерывное частное, а цикл в шейдере дискретный:
    // фактически до break по phi > PHI_MAX доходят за ~ceil(PHI_MAX/dphi) + 1
    // итераций. При текущем запасе разница не играет роли — не стоит на неё
    // полагаться, если margin когда-нибудь захотят ужать до точного равенства
    const stepsNeeded = shaderConstant('PHI_MAX') / blackHole.blackHole.integrationDphi

    expect(stepsNeeded).toBeLessThanOrEqual(shaderConstant('MAX_STEPS'))
  })

  it('над шиппинговой потребностью остаётся запас, а не только впритык', () => {
    // Подъём навивки до 6π пробовали и откатили — беды с намоткой не было,
    // дело было в грубости углового шага у фотонной сферы. Значит потолок
    // не обязан переживать 6π: он обязан переживать шиппинговую конфигурацию
    // (PHI_MAX = 3π, dphi = 0.05 → ~189 шагов) с запасом на будущее уточнение
    // dphi. Запас 30% — не впритык (тест не станет тавтологией assertion'а
    // выше), но и не резервирует несуществующее намерение подъёма навивки.
    const MARGIN_FACTOR = 1.3
    const stepsNeeded = shaderConstant('PHI_MAX') / blackHole.blackHole.integrationDphi

    expect(shaderConstant('MAX_STEPS')).toBeGreaterThanOrEqual(stepsNeeded * MARGIN_FACTOR)
  })
})
