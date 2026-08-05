import { PerspectiveCamera, Vector3 } from 'three'
import type { Effect, EffectPass } from 'postprocessing'
import { ExposureEffect } from '@/core/graphic/effects/grading/ExposureEffect'
import { ColorGradeEffect } from '@/core/graphic/effects/grading/ColorGradeEffect'
import { HDR_EFFECT_ORDER, LDR_EFFECT_ORDER, createEffectPasses } from '@/core/graphic/Postprocessing'
import { REFERENCE_TEMPERATURE_K, whiteBalanceGain } from '@/core/graphic/effects/grading/whiteBalance'
import { grading } from '@/config/grading'

// `effects` помечен private в d.ts, но в рантайме это обычное поле пасса —
// единственный способ увидеть порядок ПОСЛЕ пересортировки по attributes
function passEffects(pass: EffectPass): readonly Effect[] {
  return (pass as unknown as { effects: Effect[] }).effects
}

function assembledNames(pass: EffectPass): string[] {
  return passEffects(pass).map((effect: Effect): string => effect.name)
}

// Ключ константы порядка → имя эффекта в собранном пассе
const EFFECT_NAMES = {
  lensFlare: 'LensFlareEffect',
  bloom: 'BloomEffect',
  exposure: 'ExposureEffect',
  toneMapping: 'ToneMappingEffect',
  chromaticAberration: 'ChromaticAberrationEffect',
  colorGrade: 'ColorGradeEffect',
  dithering: 'DitheringEffect'
} as const

describe('Грейдинг: порядок в собранном проходе', () => {
  // Читаем СОБРАННЫЙ пасс, а не константы: EffectPass.setEffects сортирует
  // эффекты по убыванию attributes, и порядок аргументов конструктора не
  // сохраняется. Тест по константам был бы зелёным при любом расхождении
  let hdr: string[]
  let ldr: string[]

  beforeAll(() => {
    const [hdrPass, ldrPass] = createEffectPasses(new PerspectiveCamera())

    hdr = assembledNames(hdrPass)
    ldr = assembledNames(ldrPass)
  })

  it('константы порядка совпадают с фактической сборкой пассов', () => {
    expect(hdr).toEqual(HDR_EFFECT_ORDER.map((key: string): string => EFFECT_NAMES[key as keyof typeof EFFECT_NAMES]))
    expect(ldr).toEqual(LDR_EFFECT_ORDER.map((key: string): string => EFFECT_NAMES[key as keyof typeof EFFECT_NAMES]))
  })

  it('экспозиция считается ПОСЛЕ блума — иначе база кадра и наложение блума разъедутся по яркости', () => {
    // Порог блума экспозиция не двигает ни при каком порядке: EffectPass.render
    // зовёт update каждого эффекта по входному таргету всего пасса. Причина
    // именно в рассогласовании: текстура блума снята с неэкспонированного входа
    expect(hdr.indexOf('ExposureEffect')).toBeGreaterThan(hdr.indexOf('BloomEffect'))
  })

  it('экспозиция стоит непосредственно перед тонмаппингом', () => {
    // Экспозиция и баланс белого — свойства съёмки, они обязаны применяться в
    // линейном свете до сжатия кривой
    expect(hdr.indexOf('ExposureEffect')).toBe(hdr.indexOf('ToneMappingEffect') - 1)
  })

  it('грейдинг стоит после аберрации, дизеринг остаётся последним', () => {
    // Дизеринг последний по факту сборки, а не по порядку аргументов: появись
    // у него атрибут — сортировка увезла бы его вперёд, и тест покраснеет
    expect(ldr.indexOf('ColorGradeEffect')).toBeGreaterThan(ldr.indexOf('ChromaticAberrationEffect'))
    expect(ldr[ldr.length - 1]).toBe('DitheringEffect')
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

    // tint — единственная ручка с отдельной веткой математики (gain.y до
    // нормировки), поэтому её сеттер проверяем по зелёному каналу
    const green: number = effect.uniforms.get('gain')!.value.y

    effect.tint = 1

    expect(effect.uniforms.get('gain')!.value.y).toBeGreaterThan(green)
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
    // разведённым значениям, а тонировка последней ложится на итог.
    // Ищем сами выражения операций, а не голые имена юниформов: те совпадают
    // ещё и с блоком `uniform`-объявлений перед mainImage и не ловят
    // перестановку внутри тела функции
    const shader: string = new ColorGradeEffect().getFragmentShader()
    const positions: number[] = [
      shader.indexOf('(color - 0.5) * contrast + 0.5'),
      shader.indexOf('mix(vec3(gradeLuminance(color)), color, saturation)'),
      shader.indexOf('shadowTint * (shadowLift * shadowWeight)'),
      shader.indexOf('highlightGain * highlightWeight')
    ]

    expect(positions).toEqual([...positions].sort((a: number, b: number): number => a - b))
    expect(Math.min(...positions)).toBeGreaterThan(-1)
  })

  it('константы шейдера объявлены экранными: эффект требует sRGB на входе', () => {
    // Выход AgX — линейный display-referred. Без этого объявления опора 0.5
    // попадала бы на 188/255 экрана, а всё ниже 32/255 срезалось клампом
    expect(new ColorGradeEffect().inputColorSpace).toBe('srgb')
  })

  it('окна теней и светов не перекрываются', () => {
    // Пиксель в перекрытии тянули бы в разные оттенки аддитивный подъём теней
    // и множительная тонировка светов одновременно
    const shader: string = new ColorGradeEffect().getFragmentShader()

    expect(shader).toContain('1.0 - smoothstep(0.0, 0.5, gradeLuminance(color))')
    expect(shader).toContain('smoothstep(0.5, 1.0, gradeLuminance(color))')
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
    effect.shadowTint = [0.1, 0.2, 0.3]
    effect.highlightTint = [0.4, 0.5, 0.6]

    expect(effect.uniforms.get('contrast')!.value).toBe(1.5)
    expect(effect.shadowTint.toArray()).toEqual([0.1, 0.2, 0.3])
    expect(effect.highlightTint.toArray()).toEqual([0.4, 0.5, 0.6])
  })
})

describe('Проводка конфига в конвейер', () => {
  it('все девять ручек доезжают до эффектов внутри собранных пассов', async () => {
    // Конфиг подменяется зондом: все девять значений отличаются от дефолтов
    // конструкторов, поэтому удаление ЛЮБОЙ строки config('grading.*') в
    // Postprocessing.ts роняет эффект на дефолт и красит тест
    const probe = {
      grading: {
        exposure: 0.37,
        temperature: 4123,
        tint: 0.29,
        contrast: 1.23,
        saturation: 0.77,
        shadowTint: [0.11, 0.22, 0.33] as const,
        shadowLift: 0.044,
        highlightTint: [0.55, 0.66, 0.77] as const,
        highlightGain: 0.31
      }
    }

    vi.resetModules()
    vi.doMock('@/config/grading', () => ({ grading: probe }))

    try {
      const { createEffectPasses: build } = await import('@/core/graphic/Postprocessing')
      const [hdrPass, ldrPass] = build(new PerspectiveCamera())

      // instanceof здесь нельзя: динамический импорт после resetModules даёт
      // ДРУГИЕ экземпляры классов эффектов
      const exposure = passEffects(hdrPass).find((e: Effect): boolean => e.name === 'ExposureEffect') as ExposureEffect
      const grade = passEffects(ldrPass).find((e: Effect): boolean => e.name === 'ColorGradeEffect') as ColorGradeEffect

      expect(exposure.exposure).toBe(probe.grading.exposure)
      expect(exposure.temperature).toBe(probe.grading.temperature)
      expect(exposure.tint).toBe(probe.grading.tint)
      expect(grade.contrast).toBe(probe.grading.contrast)
      expect(grade.saturation).toBe(probe.grading.saturation)
      expect(grade.shadowLift).toBe(probe.grading.shadowLift)
      expect(grade.highlightGain).toBe(probe.grading.highlightGain)
      expect(grade.shadowTint.toArray()).toEqual([...probe.grading.shadowTint])
      expect(grade.highlightTint.toArray()).toEqual([...probe.grading.highlightTint])
    } finally {
      vi.doUnmock('@/config/grading')
      vi.resetModules()
    }
  })
})
