import { DitheringEffect } from '@/core/graphic/effects/dithering/DitheringEffect'
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
