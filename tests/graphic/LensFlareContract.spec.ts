import { TextureLoader, WebGLRenderTarget, type WebGLRenderer } from 'three'
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
    // SQRT_2 в этом файле хранит 1/√2, а не √2. length(vec2(0.5)) — это
    // 0.5 * √2, вдвое больше, чем 0.5 * SQRT_2 (= 0.5 * 1/√2). Если ghostTint
    // и falloff в sampleGhost нормируют одну и ту же length(...) разными
    // делителями, d в ghostTint доходит только до половины [0, 1] — вторая
    // половина текстуры lensColor никогда не сэмплируется
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
    // Effect.dispose() из postprocessing обходит Object.keys(this) верхнего
    // уровня и разбирает всё, что instanceof Texture. Текстура, лежащая
    // только внутри uniform'а материала, под этот обход не попадает — её
    // обязано подобрать собственное поле эффекта.
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
    // Тот же паттерн, что и у градиента призраков: собственное поле эффекта,
    // а не только значение uniform'а материала — иначе Effect.dispose() из
    // postprocessing её не найдёт и текстура утечёт при пересборке эффекта.
    const effect = new LensFlareEffect()
    const onDispose = vi.fn()
    effect.starburstTexture.addEventListener('dispose', onDispose)

    effect.dispose()

    expect(onDispose).toHaveBeenCalledOnce()
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
  // lenscolor.png и lensstar.png лежат вне git (**/textures/ в .gitignore) и в
  // проде берутся из S3. Если файла там нет, TextureLoader молча биндит
  // нулевую текстуру, тонировка призраков возвращает чёрный, а в логе — только
  // сетевая 404. Обработчик onError обязан явно предупредить в консоль.
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
    // 0.15 — не техническая граница, а вкус владельца: ненавязчивость.
    // Граница, на которой тень дыры заливается молочной пеленой, лежит
    // намного выше (см. докблок конфига) и пином не проверяется
    expect(lensFlare.lensFlare.intensity).toBe(0.15)
  })

  it('артефакты объектива включены — иначе арка тихо откатится к невидимому эффекту', () => {
    expect(lensFlare.lensFlare.starburstAmount).toBeGreaterThan(0)
    expect(lensFlare.lensFlare.ghostAmount).toBeGreaterThan(0)
  })

  it('вычитающий порог и затухание подобраны — иначе потолок вернётся к 0.15', () => {
    // Замер 03.08.2026: пара 0.5 / 12 держит тень чёрной дыры чистой до
    // intensity 5, тогда как при пороге 0 пелена появлялась уже на 3
    expect(lensFlare.lensFlare.ghostThreshold).toBe(0.5)
    expect(lensFlare.lensFlare.ghostAttenuation).toBe(12)
  })
})

describe('LensFlareEffect: вычитающий порог призраков', () => {
  it('порог вычитается из выборки ДО тонировки и до веса, а не гасит её множителем', () => {
    // Вычитание убивает постоянную составляющую: широкая тусклая площадь
    // (диск чёрной дыры целиком) уходит в ноль, а компактный пик теряет лишь
    // константу и выживает. Множитель сохранял бы форму, и площадь,
    // размноженная девятью призраками, давала бы пелену.
    // Порядок важен: порог по уже затонированному цвету резал бы палитру
    // градиента, а не значения буфера поканально
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
    // Абсолютная яркость не отличает главную звезду от фоновой: они в одном
    // диапазоне HDR, и порог, убирающий чёрточки на фоне, убирает штрих и на
    // звезде. Отличает их РАЗМЕР, а размер меряет размытие: точка в нём тонет,
    // диск сохраняет яркость
    const effect = new LensFlareEffect()
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
    // Без этого присвоения композит читает пустой семплер streakBuffer —
    // штрих молча исчезает с экрана, при этом ни один другой тест этого
    // не заметит: юниформы штриха и связь featuresMaterial с рендер-таргетом
    // проверяются раздельно
    const effect = new LensFlareEffect()

    expect(effect.featuresMaterial.streakBuffer).toBe(effect.streakTarget.texture)
  })

  it('шейдер штриха зажимает яркость перед записью в half-float таргет', () => {
    // Гейт квадратичен по яркости (сумма весов кернела 16, нормировки нет),
    // поэтому без потолка серый пиксель с яркостью около 64 уже даёт total
    // за пределом HalfFloatType (65504) — Inf и мусор на экране
    const effect = new LensFlareEffect()

    expect(effect.streakMaterial.fragmentShader).toContain('min(total * streakTint, vec3(60000.0))')
  })
})

describe('LensFlareEffect: проход локального контраста', () => {
  it('материал артефактов читает буфер локального контраста, а не предразмытый', () => {
    // Призраки обязаны отбирать пиксели по локальному контрасту: плато диска
    // звезды ярче порога во всех своих пикселях и, размноженное девятью
    // призраками, заливало кадр пеленой
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
    // Проход локального контраста занял renderTarget1 (его прежнее содержимое
    // к этому моменту уже прочитано предразмытием), поэтому артефакты
    // пишутся в renderTarget2 — новых таргетов половинного разрешения нет
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
