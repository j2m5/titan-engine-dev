import { PerspectiveCamera, SRGBColorSpace } from 'three'
import type { ShaderMaterial } from 'three'
import { DitheringEffect } from '@/core/graphic/effects/dithering/DitheringEffect'
import { createEffectPasses } from '@/core/graphic/Postprocessing'
import { BlendFunction } from 'postprocessing'

describe('DitheringEffect: дизеринг перед 8-битным квантованием', () => {
  it('IGN-шум с амплитудой в один LSB 8-бит', () => {
    const effect = new DitheringEffect()

    // Константы interleaved gradient noise (Jimenez) и амплитуда 1/255:
    // меньше — бандинг вернётся, больше — видимый шум в тенях
    expect(effect.getFragmentShader()).toContain('52.9829189')
    expect(effect.getFragmentShader()).toContain('1.0 / 255.0')
  })

  it('NORMAL-бленд: результат замещает вход, а не складывается с ним', () => {
    const effect = new DitheringEffect()

    expect(effect.blendMode.blendFunction).toBe(BlendFunction.NORMAL)
  })
})

describe('DitheringEffect: шум в экранных кодах, а не в линейном свете', () => {
  it('эффект объявляет вход в sRGB', () => {
    expect(new DitheringEffect().inputColorSpace).toBe(SRGBColorSpace)
  })

  it('собранный LDR-пасс не раскодирует цвет между грейдингом и дизерингом; раскодирует один раз — после', () => {
    const [, ldr] = createEffectPasses(new PerspectiveCamera())

    // материал пасса собирается при initialize в композере; здесь — явно
    ldr.recompile()

    const shader = (ldr.fullscreenMaterial as ShaderMaterial).fragmentShader
    const main = shader.slice(shader.indexOf('void main'))
    const encode = main.indexOf('color0 = sRGBTransferOETF(color0);')
    // дизеринг — последний эффект пасса: последний вызов MainImage
    const dither = main.lastIndexOf('MainImage(color0')

    expect(encode).toBeGreaterThan(-1)
    expect(dither).toBeGreaterThan(encode)
    expect(main.slice(encode, dither)).not.toContain('sRGBToLinear')
    expect(main.slice(dither).split('color0 = sRGBToLinear(color0);')).toHaveLength(2)
  })
})
