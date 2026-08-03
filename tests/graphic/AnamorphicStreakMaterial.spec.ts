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
    const material = new AnamorphicStreakMaterial()

    expect(material.fragmentShader).toContain('#define HALF_SAMPLES 16')
    expect(material.fragmentShader).not.toContain('uniform int')
  })

  it('ручки читаются и пишутся через свойства', () => {
    const material = new AnamorphicStreakMaterial()

    expect(material.streakThreshold).toBe(0.9)
    expect(material.streakScale).toBe(3)
    expect(material.streakTint).toEqual(new Vector3(0.1, 0.0, 1.0))

    material.streakThreshold = 1.2
    material.streakScale = 5

    expect(material.uniforms.streakThreshold.value).toBe(1.2)
    expect(material.uniforms.streakScale.value).toBe(5)
  })

  it('texelSize берётся у сэмплируемого буфера', () => {
    const material = new AnamorphicStreakMaterial()

    material.setSize(1024, 512)

    expect(material.uniforms.texelSize.value.x).toBeCloseTo(1 / 1024, 10)
    expect(material.uniforms.texelSize.value.y).toBeCloseTo(1 / 512, 10)
  })
})
