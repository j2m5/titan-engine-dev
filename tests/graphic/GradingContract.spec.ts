import { Vector3 } from 'three'
import { ExposureEffect } from '@/core/graphic/effects/grading/ExposureEffect'
import { ColorGradeEffect } from '@/core/graphic/effects/grading/ColorGradeEffect'
import { HDR_EFFECT_ORDER, LDR_EFFECT_ORDER } from '@/core/graphic/Postprocessing'
import { REFERENCE_TEMPERATURE_K, whiteBalanceGain } from '@/core/graphic/effects/grading/whiteBalance'
import { grading } from '@/config/grading'

describe('Грейдинг: порядок в конвейере', () => {
  it('экспозиция считается ПОСЛЕ блума — иначе её стопы меняли бы состав светящегося', () => {
    // Порог блума 1.0 и кламп планет 0.99 видят кадр до экспозиции, поэтому
    // инвариант bloom-guard не зависит от её значения
    expect(HDR_EFFECT_ORDER.indexOf('exposure')).toBeGreaterThan(HDR_EFFECT_ORDER.indexOf('bloom'))
  })

  it('экспозиция стоит непосредственно перед тонмаппингом', () => {
    // Экспозиция и баланс белого — свойства съёмки, они обязаны применяться в
    // линейном свете до сжатия кривой
    expect(HDR_EFFECT_ORDER.indexOf('exposure')).toBe(HDR_EFFECT_ORDER.indexOf('toneMapping') - 1)
  })

  it('грейдинг стоит после аберрации, дизеринг остаётся последним', () => {
    expect(LDR_EFFECT_ORDER.indexOf('colorGrade')).toBeGreaterThan(
      LDR_EFFECT_ORDER.indexOf('chromaticAberration')
    )
    expect(LDR_EFFECT_ORDER[LDR_EFFECT_ORDER.length - 1]).toBe('dithering')
  })
})

describe('ExposureEffect', () => {
  it('нейтральные ручки дают единичный множитель', () => {
    const effect = new ExposureEffect({ exposure: 0, temperature: REFERENCE_TEMPERATURE_K, tint: 0 })
    const gain: Vector3 = effect.uniforms.get('gain')!.value

    expect(gain.x).toBeCloseTo(1, 6)
    expect(gain.y).toBeCloseTo(1, 6)
    expect(gain.z).toBeCloseTo(1, 6)
  })

  it('множитель — произведение экспозиции и баланса белого', () => {
    const effect = new ExposureEffect({ exposure: 1, temperature: 3000, tint: 0 })
    const expected: Vector3 = whiteBalanceGain(3000, 0).multiplyScalar(2)
    const gain: Vector3 = effect.uniforms.get('gain')!.value

    expect(gain.x).toBeCloseTo(expected.x, 6)
    expect(gain.y).toBeCloseTo(expected.y, 6)
    expect(gain.z).toBeCloseTo(expected.z, 6)
  })

  it('смена любой ручки пересчитывает множитель', () => {
    const effect = new ExposureEffect()
    const before: number = effect.uniforms.get('gain')!.value.x

    effect.exposure = 2

    expect(effect.uniforms.get('gain')!.value.x).toBeCloseTo(before * 4, 6)

    effect.temperature = 3000

    expect(effect.uniforms.get('gain')!.value.x).not.toBeCloseTo(before * 4, 6)
  })

  it('шейдер только умножает — никакой цветовой математики в GLSL', () => {
    // Планковский локус и адаптация живут в чистых функциях, потому что в
    // шейдере их нельзя ни проверить, ни отладить
    const effect = new ExposureEffect()

    expect(effect.getFragmentShader()).toContain('inputColor.rgb * gain')
  })
})

describe('Конфиг грейдинга', () => {
  it('экспозиция и температура отгружаются нейтральными', () => {
    // Яркость и баланс белого без решения владельца не меняются
    expect(grading.grading.exposure).toBe(0)
    expect(grading.grading.temperature).toBe(REFERENCE_TEMPERATURE_K)
    expect(grading.grading.tint).toBe(0)
  })
})

describe('ColorGradeEffect', () => {
  it('операции идут в порядке: контраст, насыщенность, тени, света', () => {
    // Порядок не косметика: насыщенность после контраста работает по уже
    // разведённым значениям, а тонировка последней ложится на итог
    const shader: string = new ColorGradeEffect().getFragmentShader()
    const positions: number[] = [
      shader.indexOf('contrast'),
      shader.indexOf('saturation'),
      shader.indexOf('shadowLift'),
      shader.indexOf('highlightGain')
    ]

    expect(positions).toEqual([...positions].sort((a: number, b: number): number => a - b))
    expect(Math.min(...positions)).toBeGreaterThan(-1)
  })

  it('контраст считается вокруг опорной точки 0.5', () => {
    expect(new ColorGradeEffect().getFragmentShader()).toContain('(color - 0.5) * contrast + 0.5')
  })

  it('насыщенность считается относительно яркости, а не покомпонентно', () => {
    expect(new ColorGradeEffect().getFragmentShader()).toContain(
      'mix(vec3(gradeLuminance(color)), color, saturation)'
    )
  })

  it('результат не уходит в отрицательные значения', () => {
    // Подъём теней и контраст порознь могут дать минус; отрицательное в
    // half-float таргете даёт мусор после дизеринга
    expect(new ColorGradeEffect().getFragmentShader()).toContain('max(color, vec3(0.0))')
  })

  it('ручки читаются и пишутся через свойства', () => {
    const effect = new ColorGradeEffect({ contrast: 1.2, saturation: 0.8, shadowLift: 0.05, highlightGain: 0.3 })

    expect(effect.contrast).toBe(1.2)
    expect(effect.saturation).toBe(0.8)

    effect.contrast = 1.5

    expect(effect.uniforms.get('contrast')!.value).toBe(1.5)
  })

  it('все девять ручек конфига доезжают до эффектов', () => {
    const exposure = new ExposureEffect({
      exposure: grading.grading.exposure,
      temperature: grading.grading.temperature,
      tint: grading.grading.tint
    })
    const grade = new ColorGradeEffect({
      contrast: grading.grading.contrast,
      saturation: grading.grading.saturation,
      shadowTint: grading.grading.shadowTint,
      shadowLift: grading.grading.shadowLift,
      highlightTint: grading.grading.highlightTint,
      highlightGain: grading.grading.highlightGain
    })

    expect(exposure.exposure).toBe(grading.grading.exposure)
    expect(exposure.temperature).toBe(grading.grading.temperature)
    expect(exposure.tint).toBe(grading.grading.tint)
    expect(grade.contrast).toBe(grading.grading.contrast)
    expect(grade.saturation).toBe(grading.grading.saturation)
    expect(grade.shadowLift).toBe(grading.grading.shadowLift)
    expect(grade.highlightGain).toBe(grading.grading.highlightGain)
    expect(grade.shadowTint.toArray()).toEqual([...grading.grading.shadowTint])
    expect(grade.highlightTint.toArray()).toEqual([...grading.grading.highlightTint])
  })
})
