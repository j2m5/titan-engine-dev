import { HalfFloatType, TextureLoader, UnsignedByteType, WebGLRenderTarget, type WebGLRenderer } from 'three'
import type { Mock } from 'vitest'
import { BLOOM_OPTIONS } from '@/core/graphic/Postprocessing'
import { LensFlareEffect } from '@/core/graphic/effects/lensflare/LensFlareEffect'
import { lensFlare } from '@/config/lensFlare'

describe('LensFlareEffect: контракт блика объектива', () => {
  it('свечением владеет BloomEffect: своей копии блума у эффекта нет', () => {
    const effect = new LensFlareEffect()

    // Внутренний MipmapBlurPass дублировал BloomEffect в том же проходе
    // и с тем же порогом — вторая копия свечения в кадре
    expect(effect.getFragmentShader()).not.toContain('bloomBuffer')
    expect('blurPass' in effect).toBe(false)
  })

  it('порог берётся у bloom, а не своей копией числа', () => {
    const effect = new LensFlareEffect({ thresholdLevel: BLOOM_OPTIONS.luminanceThreshold })

    expect(effect.thresholdLevel).toBe(BLOOM_OPTIONS.luminanceThreshold)
  })

  it('ручки конфига доезжают до юниформов материала артефактов', () => {
    const effect = new LensFlareEffect({
      intensity: lensFlare.lensFlare.intensity,
      ghostAmount: lensFlare.lensFlare.ghostAmount,
      haloAmount: lensFlare.lensFlare.haloAmount,
      chromaticAberration: lensFlare.lensFlare.chromaticAberration
    })

    expect(effect.intensity).toBe(lensFlare.lensFlare.intensity)
    expect(effect.featuresMaterial.ghostAmount).toBe(lensFlare.lensFlare.ghostAmount)
    expect(effect.featuresMaterial.haloAmount).toBe(lensFlare.lensFlare.haloAmount)
    expect(effect.featuresMaterial.chromaticAberration).toBe(lensFlare.lensFlare.chromaticAberration)
  })
})

describe('LensFlareEffect: палитра призраков', () => {
  it('цвет призраков берётся из градиента, а не из захардкоженных vec3', () => {
    const effect = new LensFlareEffect()
    const source = effect.featuresMaterial.fragmentShader

    expect(source).toContain('uniform sampler2D lensColor;')
    expect(source).toContain('texture(lensColor,')
    // прежние девять цветов ушли в скалярные веса
    expect(source).not.toContain('vec3(0.5, 1.0, 0.4)')
  })

  it('градиент грузится с пути, который знает про режим s3', () => {
    const effect = new LensFlareEffect()

    expect(effect.featuresMaterial.lensColorTexture).not.toBeNull()
    expect(effect.featuresMaterial.lensColorTexture?.name).toBe('LensFlare.LensColor')
  })

  it('ghostTint и falloff в sampleGhost нормируют длину одним и тем же делителем — иначе правая половина градиента недостижима', () => {
    // SQRT_2 хранит 1/√2, а не √2. Если ghostTint и falloff нормируют радиус
    // разными делителями, вторая половина lensColor не сэмплируется никогда
    const effect = new LensFlareEffect()
    const source = effect.featuresMaterial.fragmentShader

    const ghostTintBody = source.match(/vec3 ghostTint\(const vec2 suv\)\s*\{([\s\S]*?)\n {2}\}/)?.[1]
    const sampleGhostBody = source.match(/vec3 sampleGhost\([^)]*\)\s*\{([\s\S]*?)\n {2}\}/)?.[1]

    expect(ghostTintBody).toBeDefined()
    expect(sampleGhostBody).toBeDefined()

    const divisor = /\/\s*\(0\.5 \* SQRT_2\)/
    expect(ghostTintBody).toMatch(divisor)
    expect(sampleGhostBody).toMatch(divisor)
  })

  it('текстура градиента освобождается штатной разборкой эффекта', () => {
    // Effect.dispose() обходит Object.keys(this): текстура, лежащая только в
    // юниформе материала, под обход не попадёт и утечёт
    const effect = new LensFlareEffect()
    const onDispose = vi.fn()
    effect.lensColorTexture.addEventListener('dispose', onDispose)

    effect.dispose()

    expect(onDispose).toHaveBeenCalledOnce()
  })
})

describe('LensFlareEffect: старберст', () => {
  it('маска подключена и по умолчанию нейтральна', () => {
    const effect = new LensFlareEffect()
    const source = effect.featuresMaterial.fragmentShader

    expect(source).toContain('uniform sampler2D starburst;')
    expect(source).toContain('1.0 + starburstAmount')
    expect(effect.featuresMaterial.starburstAmount).toBe(0)
  })

  it('текстура лучей грузится', () => {
    const effect = new LensFlareEffect()

    expect(effect.featuresMaterial.starburstTexture?.name).toBe('LensFlare.Starburst')
  })

  it('текстура лучей освобождается штатной разборкой эффекта', () => {
    // Тот же паттерн, что и у градиента призраков: поле эффекта, иначе
    // Effect.dispose() текстуру не найдёт
    const effect = new LensFlareEffect()
    const onDispose = vi.fn()
    effect.starburstTexture.addEventListener('dispose', onDispose)

    effect.dispose()

    expect(onDispose).toHaveBeenCalledOnce()
  })

  it('маска модулирует только призраков и гало: штрих прибавляется ПОСЛЕ умножения на неё', () => {
    // Маска повёрнута по крену камеры: попади штрих под неё, по полосе ездили
    // бы яркие и тусклые секторы. Проверяется позиция, а не наличие подстроки
    const effect = new LensFlareEffect()
    const body = effect.featuresMaterial.fragmentShader.match(/void main\(\)\s*\{([\s\S]*)\n {2}\}/)?.[1]

    expect(body).toBeDefined()

    const maskAt = body?.indexOf('starburstAmount * sampleStarburst()') ?? -1
    const streakAt = body?.indexOf('texture(streakBuffer, vUv)') ?? -1

    expect(maskAt).toBeGreaterThanOrEqual(0)
    expect(streakAt).toBeGreaterThan(maskAt)

    // и запись во фрагмент маску уже не применяет — иначе «после» ничего
    // не значило бы
    expect(body).toMatch(/gl_FragColor\s*=\s*features;/)
    expect(body).not.toMatch(/gl_FragColor\s*=\s*features\s*\*/)
  })

  it('поворот маски корректируется по аспекту вьюпорта — как и у гало, иначе на не квадратном экране поворот превращается в сдвиг', () => {
    const effect = new LensFlareEffect()
    const source = effect.featuresMaterial.fragmentShader
    const sampleStarburst = source.match(/float sampleStarburst\(\)[\s\S]*?\n {2}\}/)

    expect(sampleStarburst).not.toBeNull()
    expect(sampleStarburst?.[0]).toContain('vAspectRatio')
  })
})

describe('LensFlareEffect: ошибки загрузки текстур объектива', () => {
  // Ассеты объектива лежат вне git и в проде берутся из S3. Без файла
  // TextureLoader молча биндит нулевую текстуру и призраки чернеют, поэтому
  // обработчик ошибки обязан предупредить в консоль
  it('при ошибке загрузки градиента палитры пишет предупреждение с URL и последствием', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loadSpy = vi.spyOn(TextureLoader.prototype, 'load')

    const effect = new LensFlareEffect()

    const call = loadSpy.mock.calls.find(([url]) => typeof url === 'string' && url.includes('lenscolor.png'))
    expect(call).toBeDefined()
    const onError = call?.[3]
    expect(onError).toBeTypeOf('function')

    onError?.(new ErrorEvent('error'))

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[LensFlareEffect\]/))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('lenscolor.png'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('призраки'))

    warnSpy.mockRestore()
    loadSpy.mockRestore()
    effect.dispose()
  })

  it('при ошибке загрузки маски лучей пишет предупреждение с URL и последствием', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loadSpy = vi.spyOn(TextureLoader.prototype, 'load')

    const effect = new LensFlareEffect()

    const call = loadSpy.mock.calls.find(([url]) => typeof url === 'string' && url.includes('lensstar.png'))
    expect(call).toBeDefined()
    const onError = call?.[3]
    expect(onError).toBeTypeOf('function')

    onError?.(new ErrorEvent('error'))

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[LensFlareEffect\]/))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('lensstar.png'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('лучи'))

    warnSpy.mockRestore()
    loadSpy.mockRestore()
    effect.dispose()
  })
})

describe('LensFlareEffect: значения приёмки', () => {
  it('интенсивность закреплена на рабочем значении, выбранном владельцем', () => {
    // 0.15 — не техническая граница, а выбранная ненавязчивость: значение, на
    // котором возвращается пелена, под текущим конвейером не измерено
    expect(lensFlare.lensFlare.intensity).toBe(0.15)
  })

  it('артефакты объектива включены — иначе арка тихо откатится к невидимому эффекту', () => {
    expect(lensFlare.lensFlare.starburstAmount).toBeGreaterThan(0)
    expect(lensFlare.lensFlare.ghostAmount).toBeGreaterThan(0)
  })

  it('вычитающий порог и затухание не сброшены обратно в дефолты материала', () => {
    // Пин против тихого отката к дефолтам материала (0 / 3), при которых
    // призраки зеркалят плато диска целиком. Пара подбиралась на прежнем
    // конвейере и под текущим не перезамерена
    expect(lensFlare.lensFlare.ghostThreshold).toBe(0.5)
    expect(lensFlare.lensFlare.ghostAttenuation).toBe(12)
  })

  it('дефолты штриха закреплены: сила принята владельцем, остальные три — стартовая точка', () => {
    // Пин против тихого дрейфа. Сила выбрана глазом на приёмке, остальные три
    // не замерены — порог достался от вдвое более крупного источника
    expect(lensFlare.lensFlare.streakAmount).toBe(0.005)
    expect(lensFlare.lensFlare.streakThreshold).toBe(0.3)
    expect(lensFlare.lensFlare.streakScale).toBe(5)
    expect(lensFlare.lensFlare.streakTint).toEqual([0.15, 0.1, 1.0])
  })
})

describe('LensFlareEffect: вычитающий порог призраков', () => {
  it('порог вычитается из выборки ДО тонировки и до веса, а не гасит её множителем', () => {
    // Вычитание убивает постоянную составляющую, множитель сохранял бы форму.
    // Порядок важен: порог по затонированному цвету резал бы палитру градиента
    const effect = new LensFlareEffect()
    const source = effect.featuresMaterial.fragmentShader

    expect(source).toContain('uniform float ghostThreshold;')
    expect(source).toContain('max(texture(inputBuffer, suv).rgb - ghostThreshold, vec3(0.0))')
    expect(source).toContain('sampled * ghostTint(suv) * weight')
    // прежняя форма без порога
    expect(source).not.toContain('texture(inputBuffer, suv).rgb * ghostTint(suv) * weight')
  })

  it('показатель затухания — ручка, а не зашитая тройка', () => {
    const effect = new LensFlareEffect()
    const source = effect.featuresMaterial.fragmentShader

    expect(source).toContain('uniform float ghostAttenuation;')
    expect(source).toContain('pow(1.0 - d, ghostAttenuation)')
    expect(source).not.toContain('pow(1.0 - d, 3.0)')
  })

  it('дефолты тождественны прежнему коду: вычитать нечего, показатель прежний', () => {
    const effect = new LensFlareEffect()

    expect(effect.featuresMaterial.ghostThreshold).toBe(0)
    expect(effect.featuresMaterial.ghostAttenuation).toBe(3)
  })

  it('обе ручки доезжают из конфига до юниформов материала', () => {
    const effect = new LensFlareEffect({
      ghostThreshold: lensFlare.lensFlare.ghostThreshold,
      ghostAttenuation: lensFlare.lensFlare.ghostAttenuation
    })

    expect(effect.featuresMaterial.ghostThreshold).toBe(lensFlare.lensFlare.ghostThreshold)
    expect(effect.featuresMaterial.ghostAttenuation).toBe(lensFlare.lensFlare.ghostAttenuation)
  })
})

describe('LensFlareEffect: анаморфный штрих', () => {
  it('штрих читает собственный источник — понижение предразмытого буфера', () => {
    // Главную звезду от фоновых отличает размер, а не яркость, и меряет его
    // размытие. streakAmount ненулевой намеренно: при нуле проходы пропускаются
    const effect = new LensFlareEffect({ streakAmount: 0.03 })
    const inputBuffer = new WebGLRenderTarget(8, 8)
    const renderer = {
      setRenderTarget: vi.fn(),
      render: vi.fn(),
      getRenderTarget: vi.fn(() => null),
      getContext: vi.fn(() => ({}))
    } as unknown as WebGLRenderer

    effect.update(renderer, inputBuffer)

    expect(effect.streakMaterial.inputBuffer).toBe(effect.streakSourceTarget.texture)
    expect(effect.streakMaterial.inputBuffer).not.toBe(inputBuffer.texture)
    expect(effect.streakMaterial.inputBuffer).not.toBe(effect.renderTarget2.texture)
  })

  it('таргеты штриха — четверть базового разрешения', () => {
    const effect = new LensFlareEffect()

    effect.setSize(1024, 512)

    expect(effect.streakTarget.width).toBe(256)
    expect(effect.streakTarget.height).toBe(128)
    expect(effect.streakSourceTarget.width).toBe(256)
    expect(effect.streakSourceTarget.height).toBe(128)
    expect(effect.streakMaterial.uniforms.texelSize.value.x).toBeCloseTo(1 / 256, 10)
  })

  it('источник штриха разбирается штатным dispose', () => {
    const effect = new LensFlareEffect()
    const onDispose = vi.fn()
    effect.streakSourceTarget.addEventListener('dispose', onDispose)

    effect.dispose()

    expect(onDispose).toHaveBeenCalled()
  })

  it('ручки штриха доезжают из конфига до юниформов', () => {
    const effect = new LensFlareEffect({
      streakAmount: lensFlare.lensFlare.streakAmount,
      streakThreshold: lensFlare.lensFlare.streakThreshold,
      streakScale: lensFlare.lensFlare.streakScale,
      streakTint: lensFlare.lensFlare.streakTint
    })

    expect(effect.featuresMaterial.streakAmount).toBe(lensFlare.lensFlare.streakAmount)
    expect(effect.streakMaterial.streakThreshold).toBe(lensFlare.lensFlare.streakThreshold)
    expect(effect.streakMaterial.streakScale).toBe(lensFlare.lensFlare.streakScale)
    expect(effect.streakMaterial.streakTint.toArray()).toEqual([...lensFlare.lensFlare.streakTint])
  })

  it('тинт применяется один раз — в проходе, а не повторно в композите', () => {
    const effect = new LensFlareEffect()

    expect(effect.featuresMaterial.fragmentShader).toContain('texture(streakBuffer, vUv).rgb * streakAmount')
    expect(effect.featuresMaterial.fragmentShader).not.toContain('streakTint')
  })

  it('таргет штриха освобождается штатной разборкой эффекта', () => {
    // Effect.dispose() из postprocessing обходит Object.keys(this) верхнего
    // уровня; ресурс, живущий только в юниформе материала, туда не попадает
    const effect = new LensFlareEffect()
    const onDispose = vi.fn()
    effect.streakTarget.addEventListener('dispose', onDispose)

    effect.dispose()

    expect(onDispose).toHaveBeenCalledOnce()
  })

  it('таргет штриха подключён к материалу артефактов', () => {
    // Без этого присвоения композит читает пустой семплер и штрих молча
    // исчезает: остальные тесты проверяют юниформы и таргет раздельно
    const effect = new LensFlareEffect()

    expect(effect.featuresMaterial.streakBuffer).toBe(effect.streakTarget.texture)
  })

  it('шейдер штриха зажимает яркость перед записью в half-float таргет', () => {
    // Гейт квадратичен по яркости и не нормирован, поэтому без потолка серый
    // пиксель яркости около sqrt(65504 / HALF_SAMPLES) даёт Inf в half-float
    const effect = new LensFlareEffect()

    expect(effect.streakMaterial.fragmentShader).toContain('min(total * streakTint, vec3(60000.0))')
  })
})

describe('LensFlareEffect: потолок яркости источника штриха', () => {
  const HALF_SAMPLES = 64
  const TARGET_CLAMP = 60000
  /** Rec. 709 — те же коэффициенты, что вставляет пролог three в luminance() */
  const luminance = (c: readonly [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

  /**
   * CPU-зеркало накопления штриха для РОВНОЙ области яркости.
   *
   * Сумма softness по i из [-64, 64] равна ровно HALF_SAMPLES, поэтому для
   * однородного поля цикл сворачивается в одно произведение — этого достаточно,
   * чтобы поймать и насыщение, и действие потолка.
   */
  const streakForFlatField = (
    color: readonly [number, number, number],
    threshold: number,
    tint: readonly [number, number, number],
    sourceCeiling: number
  ): number[] => {
    const raw = luminance(color)
    const limited = Math.min(raw, sourceCeiling)
    const scaled = color.map((c) => (c * limited) / Math.max(raw, 1e-6))

    return scaled.map((c, i) => Math.min(c * Math.max(limited - threshold, 0) * HALF_SAMPLES * tint[i], TARGET_CLAMP))
  }

  const WHITE_TINT = [1, 1, 1] as const
  /** Sirius B: wdShade упирается в потолок HDR 64 во всех трёх каналах */
  const SIRIUS_B = [64, 64, 64] as const
  /** Обычная звезда: starEnergy максимум 3.0 * STAR_CORE_INTENSITY 4.0 */
  const STAR = [12, 11, 10] as const

  it('без потолка яркость белого карлика насыщает таргет штриха', () => {
    // Пин самой болезни: полоса упирается в клэмп по всей длине, затухание
    // вдоль неё пропадает, и она замазывает сам источник. Потолок в
    // бесконечность — это поведение до правки
    const saturated = streakForFlatField(SIRIUS_B, 0.3, WHITE_TINT, Infinity)

    expect(saturated.every((c) => c === TARGET_CLAMP)).toBe(true)
  })

  it('потолок 16 уводит карлика из насыщения и возвращает затухание', () => {
    const limited = streakForFlatField(SIRIUS_B, 0.3, WHITE_TINT, 16)

    expect(limited.every((c) => c < TARGET_CLAMP)).toBe(true)
  })

  it('источник выше потолка даёт ровно то же, что источник НА потолке', () => {
    // Смысл потолка: выше него яркость перестаёт влиять на штрих вовсе.
    // Иначе Sirius B и G29-38 давали бы разный по силе штрих там, где оба
    // уже за пределом линейного режима
    const atCeiling = streakForFlatField([16, 16, 16], 0.3, WHITE_TINT, 16)
    const wayAbove = streakForFlatField(SIRIUS_B, 0.3, WHITE_TINT, 16)

    wayAbove.forEach((value, i) => expect(value).toBeCloseTo(atCeiling[i], 6))
  })

  it('ниже потолка не меняется ничего — звезда и диск ЧД остаются как были', () => {
    // Потолок обязан быть невидим для всего, что уже работало: иначе это не
    // починка карлика, а перенастройка всех сцен разом
    const before = streakForFlatField(STAR, 0.3, WHITE_TINT, Infinity)
    const after = streakForFlatField(STAR, 0.3, WHITE_TINT, 16)

    after.forEach((value, i) => expect(value).toBeCloseTo(before[i], 6))
  })

  it('оттенок источника сохраняется: делится общий множитель, а не каналы порознь', () => {
    // Поканальный кламп у Sirius B (64,64,64) прошёл бы незаметно, а у
    // G29-38 (25.3, 31.5, 47.9) сплющил бы синеву в белое
    const g2938 = [25.3, 31.5, 47.9] as const
    const limited = streakForFlatField(g2938, 0.3, WHITE_TINT, 16)

    expect(limited[2] / limited[0]).toBeCloseTo(g2938[2] / g2938[0], 6)
  })

  it('нулевой потолок гасит штрих — точка отката', () => {
    expect(streakForFlatField(SIRIUS_B, 0.3, WHITE_TINT, 0)).toEqual([0, 0, 0])
  })

  it('шейдер ограничивает ЯРКОСТЬ источника до гейта, а не результат после него', () => {
    const effect = new LensFlareEffect()
    const source = effect.streakMaterial.fragmentShader

    expect(source).toContain('uniform float streakSourceCeiling;')
    expect(source).toContain('float limited = min(rawLuma, streakSourceCeiling);')
    // гейт обязан считаться по ОГРАНИЧЕННОЙ яркости, иначе потолок ничего не даёт
    expect(source).toContain('max(limited - streakThreshold, 0.0)')
    expect(source).not.toContain('max(luminance(color) - streakThreshold, 0.0)')
  })

  it('ручка доезжает из конфига до юниформа', () => {
    const effect = new LensFlareEffect({ streakSourceCeiling: lensFlare.lensFlare.streakSourceCeiling })

    expect(effect.streakMaterial.streakSourceCeiling).toBe(lensFlare.lensFlare.streakSourceCeiling)
  })

  it('потолок закреплён ниже точки насыщения и выше рабочих сцен', () => {
    // 31 — измеренная по формуле точка, где таргет клипается; звезда даёт ~10,
    // номинальный диск ЧД ~16. Потолок обязан лежать между ними
    expect(lensFlare.lensFlare.streakSourceCeiling).toBeLessThan(31)
    expect(lensFlare.lensFlare.streakSourceCeiling).toBeGreaterThanOrEqual(16)
  })
})

describe('LensFlareEffect: проход локального контраста', () => {
  it('материал артефактов читает буфер локального контраста, а не предразмытый', () => {
    // Призраки обязаны отбирать по локальному контрасту: плато диска звезды
    // ярче порога во всех своих пикселях и заливало кадр пеленой
    const effect = new LensFlareEffect()
    const inputBuffer = new WebGLRenderTarget(8, 8)
    const renderer = {
      setRenderTarget: vi.fn(),
      render: vi.fn(),
      getRenderTarget: vi.fn(() => null),
      getContext: vi.fn(() => ({}))
    } as unknown as WebGLRenderer

    effect.update(renderer, inputBuffer)

    expect(effect.featuresMaterial.inputBuffer).toBe(effect.renderTarget1.texture)
    expect(effect.localContrastMaterial.inputBuffer).toBe(effect.renderTarget2.texture)
  })

  it('готовые артефакты лежат в renderTarget2', () => {
    // Локальный контраст занял renderTarget1, поэтому артефакты пишутся в
    // renderTarget2: новых таргетов половинного разрешения нет
    const effect = new LensFlareEffect()

    expect(effect.uniforms.get('featuresBuffer').value).toBe(effect.renderTarget2.texture)
  })

  it('материал локального контраста следует за ресайзом', () => {
    const effect = new LensFlareEffect()

    effect.setSize(1024, 512)

    expect(effect.localContrastMaterial.uniforms.texelSize.value.x).toBeCloseTo(1 / 512, 10)
    expect(effect.localContrastMaterial.uniforms.texelSize.value.y).toBeCloseTo(1 / 256, 10)
  })

  it('проход локального контраста разбирается штатным dispose', () => {
    // Effect.dispose() обходит Object.keys(this): ресурс, живущий только
    // внутри другого объекта, под обход не попадает и течёт
    const effect = new LensFlareEffect()
    const onDispose = vi.fn()
    effect.localContrastMaterial.addEventListener('dispose', onDispose)

    effect.dispose()

    expect(onDispose).toHaveBeenCalled()
  })
})

/** Мок рендерера: интересна только последовательность вызовов setRenderTarget */
const createRendererStub = (): { setRenderTarget: Mock; render: Mock } & Record<string, unknown> => ({
  setRenderTarget: vi.fn(),
  render: vi.fn(),
  getRenderTarget: vi.fn(() => null),
  getContext: vi.fn(() => ({}))
})

/**
 * Адреса записи ИМЕННО в таргеты эффекта, по порядку. Внутренние таргеты
 * KawaseBlurPass (renderTargetA/B предразмытия и источника штриха) сюда не
 * попадают: это чужие объекты, и их число зависит от размера ядра
 */
const writeSequence = (effect: LensFlareEffect, renderer: { setRenderTarget: Mock }): unknown[] => {
  const own: unknown[] = [effect.renderTarget1, effect.renderTarget2, effect.streakSourceTarget, effect.streakTarget]
  return renderer.setRenderTarget.mock.calls.map(([target]) => target).filter((target) => own.includes(target))
}

describe('LensFlareEffect: порядок проходов и адреса записи', () => {
  // Проверять вход прохода недостаточно: его выставляет сам ShaderPass.render,
  // и ни смена адреса записи, ни перестановка проходов ни одного inputBuffer не
  // меняют. Единственный наблюдаемый след порядка — последовательность
  // renderer.setRenderTarget
  it('шесть проходов идут в фиксированном порядке, каждый в свой таргет', () => {
    const effect = new LensFlareEffect({ streakAmount: lensFlare.lensFlare.streakAmount })
    const renderer = createRendererStub()

    effect.update(renderer as unknown as WebGLRenderer, new WebGLRenderTarget(8, 8))

    expect(writeSequence(effect, renderer)).toEqual([
      effect.renderTarget1, // 1. порог и даунсэмпл
      effect.renderTarget2, // 2. предразмытие Kawase SMALL
      effect.streakSourceTarget, // 3. собственный источник штриха, Kawase MEDIUM
      effect.streakTarget, // 4. сам штрих
      effect.renderTarget1, // 5. локальный контраст — ОБЯЗАН быть до артефактов
      effect.renderTarget2 // 6. артефакты; их и читает композит эффекта
    ])
    // адрес шестого прохода обязан совпадать с тем, что читает композит
    expect(effect.uniforms.get('featuresBuffer').value).toBe(effect.renderTarget2.texture)
  })
})

describe('LensFlareEffect: пропуск проходов штриха', () => {
  it('при нулевом вкладе штриха оба его прохода не выполняются', () => {
    // Kawase-источник и 129 выборок на пиксель стоили бы полную цену даже при
    // нулевом вкладе штриха
    const effect = new LensFlareEffect({ streakAmount: 0 })
    const renderer = createRendererStub()

    effect.update(renderer as unknown as WebGLRenderer, new WebGLRenderTarget(8, 8))

    const written = writeSequence(effect, renderer)

    expect(written).toEqual([effect.renderTarget1, effect.renderTarget2, effect.renderTarget1, effect.renderTarget2])
    expect(written).not.toContain(effect.streakSourceTarget)
    expect(written).not.toContain(effect.streakTarget)
  })

  it('устаревшее содержимое streakTarget при пропуске на кадр не влияет', () => {
    // Единственный читатель streakTarget — выборка в композите артефактов,
    // умноженная на streakAmount. При нуле произведение нулевое независимо от
    // того, что осталось в таргете с прошлого кадра
    const effect = new LensFlareEffect({ streakAmount: 0 })

    expect(effect.featuresMaterial.fragmentShader).toContain('texture(streakBuffer, vUv).rgb * streakAmount')
    expect(effect.featuresMaterial.streakAmount).toBe(0)
    // и других обращений к streakBuffer в шейдере нет
    expect(effect.featuresMaterial.fragmentShader.match(/streakBuffer/g)).toHaveLength(2)
  })

  it('при ненулевом вкладе проходы штриха выполняются', () => {
    const effect = new LensFlareEffect({ streakAmount: 0.03 })
    const renderer = createRendererStub()

    effect.update(renderer as unknown as WebGLRenderer, new WebGLRenderTarget(8, 8))

    const written = writeSequence(effect, renderer)

    expect(written).toContain(effect.streakSourceTarget)
    expect(written).toContain(effect.streakTarget)
  })
})

describe('LensFlareEffect: инициализация проходов', () => {
  it('источник штриха получает тип кадрового буфера — иначе HDR выше единицы срезается', () => {
    // KawaseBlurPass создаёт внутренние таргеты UnsignedByteType и меняет тип
    // только в initialize(). Без вызова источник штриха обрезается по единице,
    // гейт даёт почти ноль, и штрих молча исчезает
    const effect = new LensFlareEffect()
    const internals = effect.streakSourcePass as unknown as {
      renderTargetA: WebGLRenderTarget
      renderTargetB: WebGLRenderTarget
    }

    expect(internals.renderTargetA.texture.type).toBe(UnsignedByteType)

    effect.initialize(createRendererStub() as unknown as WebGLRenderer, false, HalfFloatType)

    expect(internals.renderTargetA.texture.type).toBe(HalfFloatType)
    expect(internals.renderTargetB.texture.type).toBe(HalfFloatType)
  })

  it('initialize доходит до всех проходов эффекта, а не только до части', () => {
    // ShaderPass.initialize поднимает FRAMEBUFFER_PRECISION_HIGH у своего
    // материала; забытый в списке проход тихо потеряет точность
    const effect = new LensFlareEffect()

    effect.initialize(createRendererStub() as unknown as WebGLRenderer, false, HalfFloatType)

    expect(effect.thresholdMaterial.defines.FRAMEBUFFER_PRECISION_HIGH).toBe('1')
    expect(effect.localContrastMaterial.defines.FRAMEBUFFER_PRECISION_HIGH).toBe('1')
    expect(effect.featuresMaterial.defines.FRAMEBUFFER_PRECISION_HIGH).toBe('1')
    expect(effect.streakMaterial.defines.FRAMEBUFFER_PRECISION_HIGH).toBe('1')
  })
})

describe('LensFlareEffect: разборка ресурсов штриха и локального контраста', () => {
  it('проход-источник штриха, материал штриха и проход локального контраста разбираются штатным dispose', () => {
    // Effect.dispose() обходит Object.keys(this) и разбирает всё, что
    // instanceof Texture/Material/WebGLRenderTarget/Pass. Ресурс, спрятанный
    // внутрь другого объекта, под обход не попадает и течёт на каждой
    // пересборке эффекта
    const effect = new LensFlareEffect()
    const streakSourcePassDispose = vi.spyOn(effect.streakSourcePass, 'dispose')
    const streakMaterialDispose = vi.spyOn(effect.streakMaterial, 'dispose')
    const localContrastPassDispose = vi.spyOn(effect.localContrastPass, 'dispose')

    effect.dispose()

    expect(streakSourcePassDispose).toHaveBeenCalled()
    expect(streakMaterialDispose).toHaveBeenCalled()
    expect(localContrastPassDispose).toHaveBeenCalled()
  })
})
