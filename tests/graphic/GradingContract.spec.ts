import { Vector3 } from 'three'
import { ExposureEffect } from '@/core/graphic/effects/grading/ExposureEffect'
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
