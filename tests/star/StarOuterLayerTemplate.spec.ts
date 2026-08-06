import { StarOuterLayerShaderTemplate } from '@/core/materials/shaders/lib/StarOuterLayerShaderTemplate'
import { toThreeJSUnits } from '@/core/helpers/scaling'

describe('StarOuterLayerShaderTemplate: палитра протуберанцев от спектра звезды', () => {
  const vert: string = StarOuterLayerShaderTemplate.vertexShader
  const uniforms = StarOuterLayerShaderTemplate.uniforms

  it('радужная hue-палитра удалена', () => {
    expect(vert).not.toContain('#define hue')
    expect(vert).not.toContain('uHue')
  })

  it('цвет — интерполяция чёрнотельной палитры с HDR-интенсивностью', () => {
    expect(vert).toContain('mix(uColorCool, uColorBase, aRibbonRandom.z)')
    expect(vert).toContain('uProtuberanceIntensity')
  })

  it('юниформы палитры объявлены, hue-юниформы удалены', () => {
    expect(uniforms.uColorCool).toBeDefined()
    expect(uniforms.uColorBase).toBeDefined()
    expect(uniforms.uProtuberanceIntensity.value).toBe(6.0)
    expect(uniforms.uHue).toBeUndefined()
    expect(uniforms.uHueSpread).toBeUndefined()
  })
})

describe('StarOuterLayerShaderTemplate: толщина ленты — доля радиуса звезды', () => {
  const vert: string = StarOuterLayerShaderTemplate.vertexShader
  const uniforms = StarOuterLayerShaderTemplate.uniforms

  it('ручка ширины сменила единицы вместе с именем', () => {
    // Прежний uWidth мерил мировые единицы, новый — долю радиуса: значение
    // упало примерно в 350 раз, и одноимённая ручка с новым смыслом поймала бы
    // того, кто полезет её крутить
    expect(uniforms.uWidth).toBeUndefined()
    expect(uniforms.uWidthFraction.value).toBe(0.00086)
  })

  it('0.00086 воспроизводит прежнюю толщину у Солнца — это и есть происхождение числа', () => {
    // Прежняя полутолщина при animPhase = 0 равнялась uWidth = 0.3 мировых
    // единиц. Пин привязывает константу к её обоснованию: иначе через полгода
    // происхождение числа снова будет неизвестно, как было с этим слоем
    const sunRadiusWorld: number = toThreeJSUnits(696000)

    expect(uniforms.uWidthFraction.value * sunRadiusWorld).toBeCloseTo(0.3, 3)
  })

  it('радиус берётся из modelMatrix, а не как длина нормализованного атрибута', () => {
    // length(aFootA) — единица объектного пространства: толщина выходила
    // абсолютной, и у мелкой звезды нити были втрое толще относительно диска
    expect(vert).toContain('float starRadiusW = length((modelMatrix * vec4(aFootA, 0.0)).xyz)')
    expect(vert).not.toContain('length(aFootA)')
    expect(vert).toContain('uWidthFraction * aRibbon.y * (1.0 + animPhase) * starRadiusW')
  })

  it('мёртвое затухание у поверхности удалено вместе со своими переменными', () => {
    // smoothstep(R, R * 1.03, lenW) сравнивал мировую длину с объектной
    // единицей и был тождественно равен 1.0; после его удаления centerW и lenW
    // остались без потребителей
    expect(vert).not.toContain('smoothstep(')
    expect(vert).not.toContain('lenW')
    expect(vert).not.toContain('centerW')
    expect(vert).toContain('vOpacity = (1.0 - animPhase) * uOpacity;')
  })
})
