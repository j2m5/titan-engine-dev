import { Vector3 } from 'three'
import { AnamorphicStreakMaterial } from '@/core/graphic/effects/lensflare/AnamorphicStreakMaterial'

describe('AnamorphicStreakMaterial: анаморфный штрих', () => {
  it('гейт множительный и стоит внутри цикла отсчётов', () => {
    // Множитель max(lum - threshold, 0) не ограничен сверху: тусклое гасится
    // в ноль, яркое ядро вытягивается сильнее линейного — отсюда тонкая черта.
    // Вычитающая форма — это призраки, у них другая механика
    const material = new AnamorphicStreakMaterial()

    expect(material.fragmentShader).toContain('max(luminance(color) - streakThreshold, 0.0)')
    expect(material.fragmentShader).not.toContain('- streakThreshold, vec3(0.0))')
  })

  it('отсчёты идут только по горизонтали', () => {
    const material = new AnamorphicStreakMaterial()

    expect(material.fragmentShader).toContain('vec2(texelSize.x * float(i) * streakScale, 0.0)')
  })

  it('число отсчётов — константа шейдера, а не юниформ', () => {
    // 129 отсчётов вместо прежних 33: при большом вылете редкие отсчёты дают
    // видимые копии диска источника вдоль полосы и рубленый край
    const material = new AnamorphicStreakMaterial()

    expect(material.fragmentShader).toContain('#define HALF_SAMPLES 64')
    expect(material.fragmentShader).not.toContain('uniform int')
  })

  it('цикл включает оба края — треугольный вес гасится в ноль симметрично', () => {
    // i < HALF_SAMPLES давал асимметрию: левый хвост гаснет в ноль на -16,
    // правый обрывается на 15 с весом 0.0625. i <= HALF_SAMPLES гасит оба края.
    const material = new AnamorphicStreakMaterial()

    expect(material.fragmentShader).toContain('for (int i = -HALF_SAMPLES; i <= HALF_SAMPLES; i++)')
  })

  it('ручки читаются и пишутся через свойства', () => {
    const material = new AnamorphicStreakMaterial()

    expect(material.streakThreshold).toBe(0.3)
    expect(material.streakScale).toBe(5)
    expect(material.streakTint).toEqual(new Vector3(0.45, 0.6, 1.0))

    material.streakThreshold = 1.2
    material.streakScale = 7

    expect(material.uniforms.streakThreshold.value).toBe(1.2)
    expect(material.uniforms.streakScale.value).toBe(7)
  })

  it('texelSize берётся у сэмплируемого буфера', () => {
    const material = new AnamorphicStreakMaterial()

    material.setSize(1024, 512)

    expect(material.uniforms.texelSize.value.x).toBeCloseTo(1 / 1024, 10)
    expect(material.uniforms.texelSize.value.y).toBeCloseTo(1 / 512, 10)
  })
})
