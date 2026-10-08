import { FloatType, HalfFloatType, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import { AtmosphereLUTGenerator, lutTextureType } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'

const FULL_FLOAT = ['EXT_color_buffer_float', 'OES_texture_float_linear', 'EXT_float_blend']

function rendererWith(extensions: string[]): WebGLRenderer {
  return { extensions: { has: (name: string): boolean => extensions.includes(name) } } as unknown as WebGLRenderer
}

/**
 * Float-LUT с LinearFilter без OES_texture_float_linear неполна — сэмплер
 * отдаёт чёрное (Safari на iOS), без EXT_float_blend не накапливается
 * многократное рассеяние. Тогда LUT — half float.
 */
describe('Тип текстур LUT атмосферы по возможностям устройства', () => {
  it('полная поддержка float — FloatType, как раньше', () => {
    expect(lutTextureType(rendererWith(FULL_FLOAT))).toBe(FloatType)
  })

  it.each(FULL_FLOAT)('без %s — HalfFloatType', (missing: string) => {
    expect(lutTextureType(rendererWith(FULL_FLOAT.filter((name) => name !== missing)))).toBe(HalfFloatType)
  })

  it('выходные LUT генератора создаются выбранным типом', () => {
    const generator = new AtmosphereLUTGenerator(rendererWith([]))
    const targets = generator as unknown as Record<
      'transmittanceRT' | 'scatteringRT' | 'irradianceRT',
      WebGLRenderTarget
    >

    expect(targets.transmittanceRT.texture.type).toBe(HalfFloatType)
    expect(targets.scatteringRT.texture.type).toBe(HalfFloatType)
    expect(targets.irradianceRT.texture.type).toBe(HalfFloatType)
    generator.dispose()
  })
})
