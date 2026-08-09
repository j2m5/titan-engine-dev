import {
  buildStarPalette,
  colorTemperatureToRGB,
  COLOR_TEMPERATURE_FLOOR_K,
  mixColor,
  normalizeColor,
  srgbColorToLinear
} from '@/core/materials/shaders/lib/helpers'

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
    // Конечность держит пол COLOR_TEMPERATURE_FLOOR_K: прежний Math.max(..., 1)
    // спасал только от log неположительного
    const palette = buildStarPalette(100, 400)
    for (const c of [palette.cool, palette.base, palette.hot]) {
      for (const v of [c.r, c.g, c.b]) {
        expect(Number.isFinite(v)).toBe(true)
      }
    }
  })
})

describe('пол температуры: ниже 1000 K аппроксимация не определена', () => {
  it('холодный конец ниже пола считается по полу', () => {
    // 1210 − 600 = 610 K, аппроксимация Таннера Хелланда определена от 1000 K
    expect(buildStarPalette(1210, 600).cool).toEqual(buildStarPalette(1000, 0).base)
  })

  it('выше пола ничего не клампится', () => {
    expect(buildStarPalette(5800, 400).cool).toEqual(
      srgbColorToLinear(normalizeColor(colorTemperatureToRGB(5400)))
    )
  })

  it('пол экспортирован числом, а не зашит в формулу', () => {
    expect(COLOR_TEMPERATURE_FLOOR_K).toBe(1000)
  })
})

describe('mixColor', () => {
  const a = { r: 1, g: 0.2, b: 0 }
  const b = { r: 0.1, g: 0.4, b: 0.9 }

  it('границы дают исходные цвета точно', () => {
    // Форма a*(1-t) + b*t точна на обоих концах; a + (b-a)*t при t = 1
    // дала бы 0.09999999999999998 вместо 0.1
    expect(mixColor(a, b, 0)).toEqual(a)
    expect(mixColor(a, b, 1)).toEqual(b)
  })

  it('середина — поканальное среднее', () => {
    const m = mixColor(a, b, 0.5)

    expect(m.r).toBeCloseTo(0.55, 12)
    expect(m.g).toBeCloseTo(0.3, 12)
    expect(m.b).toBeCloseTo(0.45, 12)
  })
})
