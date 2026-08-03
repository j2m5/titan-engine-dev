import { TextureLoader } from 'three'
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
  it('интенсивность не выше потолка, заданного сценой чёрной дыры', () => {
    // При 3 тень дыры заливается молочной пеленой с цветными разводами.
    // Владелец правил в сторону ненавязчивости: общий уровень низкий
    expect(lensFlare.lensFlare.intensity).toBe(0.15)
  })

  it('артефакты объектива включены — иначе арка тихо откатится к невидимому эффекту', () => {
    expect(lensFlare.lensFlare.starburstAmount).toBeGreaterThan(0)
    expect(lensFlare.lensFlare.ghostAmount).toBeGreaterThan(0)
  })
})

describe('LensFlareEffect: вычитающий порог призраков', () => {
  it('порог вычитается из выборки ДО тонировки и до веса, а не гасит её множителем', () => {
    // Вычитание убивает постоянную составляющую: широкая тусклая площадь
    // (диск чёрной дыры целиком) уходит в ноль, а компактный пик теряет лишь
    // константу и выживает. Множитель сохранял бы форму, и площадь,
    // размноженная девятью призраками, давала бы пелену.
    // Порядок важен: порог по уже затонированному цвету резал бы палитру
    // градиента, а не яркость
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
