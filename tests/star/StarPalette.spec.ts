import { buildStarPalette, colorTemperatureToRGB, normalizeColor, srgbColorToLinear } from '@/core/materials/shaders/lib/helpers'

describe('buildStarPalette: чёрнотельная палитра звезды', () => {
  it('base совпадает с srgbColorToLinear(normalizeColor(colorTemperatureToRGB(T)))', () => {
    const palette = buildStarPalette(5800)
    expect(palette.base).toEqual(srgbColorToLinear(normalizeColor(colorTemperatureToRGB(5800))))
  })

  it('cool краснее hot (ниже отношение blue/red)', () => {
    const palette = buildStarPalette(5800)
    const coolRatio = palette.cool.b / palette.cool.r
    const hotRatio = palette.hot.b / palette.hot.r
    expect(coolRatio).toBeLessThan(hotRatio)
  })

  it('все компоненты нормализованы в [0, 1]', () => {
    const palette = buildStarPalette(3000)
    for (const c of [palette.cool, palette.base, palette.hot]) {
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('spreadK = 0 даёт три одинаковых цвета', () => {
    const palette = buildStarPalette(5800, 0)
    expect(palette.cool).toEqual(palette.base)
    expect(palette.hot).toEqual(palette.base)
  })

  it('низкие температуры (около 0) не дают NaN', () => {
    const palette = buildStarPalette(100, 400)
    for (const c of [palette.cool, palette.base, palette.hot]) {
      for (const v of [c.r, c.g, c.b]) {
        expect(Number.isFinite(v)).toBe(true)
      }
    }
  })
})
