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
