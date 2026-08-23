import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  bandLowKmFor,
  boxDownsampleGreyscale,
  elevationHighPassSigmaTexels,
  elevationPeakMeters,
  elevationSmoothSigmaTexels,
  resolutionCeiling
} from '../../scripts/lib/batchBodyRules'

describe('resolutionCeiling: потолок разрешения по радиусу тела', () => {
  it('≥1500 км → 8192, граница включительно', () => {
    expect(resolutionCeiling(1_500_000)).toBe(8192)
  })

  it('чуть ниже 1500 км → 4096, а не 8192', () => {
    expect(resolutionCeiling(1_499_999)).toBe(4096)
  })

  it('500–1500 км → 4096, граница включительно', () => {
    expect(resolutionCeiling(500_000)).toBe(4096)
  })

  it('чуть ниже 500 км → 2048, а не 4096', () => {
    expect(resolutionCeiling(499_999)).toBe(2048)
  })

  it('крупное тело (Явин IV, 6100 км) → 8192', () => {
    expect(resolutionCeiling(6_100_000)).toBe(8192)
  })

  it('мелкое тело (Корribан VII, 175 км) → 2048', () => {
    expect(resolutionCeiling(175_000)).toBe(2048)
  })
})

describe('resolutionCeiling: явный override потолка', () => {
  it('override побеждает правило по радиусу (Плутон 1188 км: 4096 → 8192)', () => {
    expect(resolutionCeiling(1_188_300)).toBe(4096)
    expect(resolutionCeiling(1_188_300, 8192)).toBe(8192)
  })

  it('override ниже автоправила тоже принимается (потолок задаёт данные, не радиус)', () => {
    expect(resolutionCeiling(6_100_000, 2048)).toBe(2048)
  })

  it('верхняя граница 16384 допустима', () => {
    expect(resolutionCeiling(1_188_300, 16384)).toBe(16384)
  })

  it('override > 16384 отвергается', () => {
    expect(() => resolutionCeiling(1_188_300, 32768)).toThrow()
  })

  it('override не степень двойки отвергается', () => {
    expect(() => resolutionCeiling(1_188_300, 3000)).toThrow()
  })

  it('нулевой и отрицательный override отвергаются', () => {
    expect(() => resolutionCeiling(1_188_300, 0)).toThrow()
    expect(() => resolutionCeiling(1_188_300, -2048)).toThrow()
  })

  it('undefined — прежняя логика по радиусу', () => {
    expect(resolutionCeiling(1_188_300, undefined)).toBe(4096)
  })
})

describe('bandLowKmFor: band-low = min(1500, полуокружность тела)', () => {
  it('крупное тело: полуокружность далеко за 1500 км → дефолт 1500', () => {
    // R=2000 км → полуокружность π·2000 ≈ 6283 км, дефолт побеждает
    expect(bandLowKmFor(2_000_000)).toBe(1500)
  })

  it('порог перехода ~477.46 км: чуть выше — ещё дефолт 1500', () => {
    // π·R/1000 = 1500 при R = 1500000/π ≈ 477464.83 м
    const thresholdMeters = (1500 * 1000) / Math.PI
    expect(bandLowKmFor(thresholdMeters + 1000)).toBe(1500)
  })

  it('порог перехода ~477.46 км: чуть ниже — уже половина окружности', () => {
    const thresholdMeters = (1500 * 1000) / Math.PI
    const result = bandLowKmFor(thresholdMeters - 1000)
    expect(result).toBeLessThan(1500)
    expect(result).toBeCloseTo((Math.PI * (thresholdMeters - 1000)) / 1000, 6)
  })

  it('малое тело (Дисномия, 320 км): формула min(1500, πR/1000) даёт половину окружности', () => {
    const radiusMeters = 320_000
    const expectedKm = (Math.PI * radiusMeters) / 1000
    expect(bandLowKmFor(radiusMeters)).toBeCloseTo(expectedKm, 6)
    expect(bandLowKmFor(radiusMeters)).toBeLessThan(1500)
  })

  it('самое малое тело батча (Корribан VII, 175 км): половина окружности ~550 км', () => {
    expect(bandLowKmFor(175_000)).toBeCloseTo((Math.PI * 175_000) / 1000, 6)
  })
})

describe('elevationPeakMeters: пик высоты для входа elevation', () => {
  it('без override — бюджет 0.7% радиуса (Плутон не меняется)', () => {
    const radiusMeters = 1_188_300
    expect(elevationPeakMeters(radiusMeters)).toBeCloseTo(0.007 * radiusMeters, 6)
  })

  it('override в пределах бюджета принимается как есть (Европа: 1800 м при бюджете ~10927 м)', () => {
    expect(elevationPeakMeters(1_561_000, 1800)).toBe(1800)
  })

  it('override ровно на бюджете — граница включительно', () => {
    const radiusMeters = 1_000_000
    const budgetMeters = 0.007 * radiusMeters
    expect(elevationPeakMeters(radiusMeters, budgetMeters)).toBeCloseTo(budgetMeters, 6)
  })

  it('override выше бюджета отвергается', () => {
    const radiusMeters = 1_000_000
    const budgetMeters = 0.007 * radiusMeters
    expect(() => elevationPeakMeters(radiusMeters, budgetMeters + 1)).toThrow()
  })

  it('нулевой и отрицательный override отвергаются', () => {
    expect(() => elevationPeakMeters(1_000_000, 0)).toThrow()
    expect(() => elevationPeakMeters(1_000_000, -100)).toThrow()
  })
})

describe('elevationSmoothSigmaTexels: σ сглаживания входа elevation', () => {
  it('без override — дефолт (Плутон и Европа не меняются)', () => {
    expect(elevationSmoothSigmaTexels(0.7)).toBe(0.7)
  })

  it('override в пределах (0, 4] принимается как есть (Эрида: 1.5)', () => {
    expect(elevationSmoothSigmaTexels(0.7, 1.5)).toBe(1.5)
  })

  it('override ровно на верхней границе 4 — включительно', () => {
    expect(elevationSmoothSigmaTexels(0.7, 4)).toBe(4)
  })

  it('override выше 4 отвергается', () => {
    expect(() => elevationSmoothSigmaTexels(0.7, 4.0001)).toThrow()
  })

  it('нулевой и отрицательный override отвергаются', () => {
    expect(() => elevationSmoothSigmaTexels(0.7, 0)).toThrow()
    expect(() => elevationSmoothSigmaTexels(0.7, -1)).toThrow()
  })
})

describe('elevationHighPassSigmaTexels: σ высокочастотного фильтра входа elevation', () => {
  it('без highPassKm — undefined (большинство тел без фильтра)', () => {
    expect(elevationHighPassSigmaTexels(1000)).toBeUndefined()
  })

  it('переводит км в тексели той же формулой, что край band-фильтра bump-входа (highPassKm·1000 / equatorTexelMeters)', () => {
    expect(elevationHighPassSigmaTexels(2000, 800)).toBeCloseTo(400, 6)
  })

  it('нулевой и отрицательный highPassKm отвергаются', () => {
    expect(() => elevationHighPassSigmaTexels(2000, 0)).toThrow()
    expect(() => elevationHighPassSigmaTexels(2000, -10)).toThrow()
  })
})

describe('boxDownsampleGreyscale: area-average даунсемпл 2:1', () => {
  it('однородный блок переживает 2:1 без сдвига среднего', () => {
    const source = Buffer.from([
      100, 100, 100, 100,
      100, 100, 100, 100
    ])

    const result = boxDownsampleGreyscale(source, 4, 2, 2, 1)

    expect(Array.from(result)).toEqual([100 / 255, 100 / 255])
  })

  it('среднее блока 2×2 сохраняется — четыре разных блока не путают оси', () => {
    // источник 4×2, блоки 2×1 (сокращение 2:1 только по X): левая половина
    // строки — байт 0, правая — байт 255; среднее блока 2×1 остаётся 0 или 255
    // (каждый блок однороден по построению), проверяет саму раскладку блоков
    const source = Buffer.from([
      0, 0, 255, 255,
      0, 0, 255, 255
    ])

    const result = boxDownsampleGreyscale(source, 4, 2, 2, 2)

    expect(Array.from(result)).toEqual([0, 1, 0, 1])
  })

  it('area-average блока 2×2 даёт истинное среднее, не крайнее значение', () => {
    // один блок 2×2 со значениями 0, 85, 170, 255 — среднее 127.5/255 = 0.5
    const source = Buffer.from([
      0, 85,
      170, 255
    ])

    const result = boxDownsampleGreyscale(source, 2, 2, 1, 1)

    expect(result[0]).toBeCloseTo(0.5, 6)
  })

  it('глобальное среднее по всему изображению сохраняется после 2:1 даунсемпла', () => {
    // 8×4 источник псевдослучайных байтов; сумма/(255·N) исходника должна
    // совпасть со средним даунсемпленного 4×2 результата — area-average не
    // теряет и не добавляет энергию сигнала
    const width = 8
    const heightPx = 4
    const bytes = Array.from({ length: width * heightPx }, (_, i) => (i * 37) % 256)
    const source = Buffer.from(bytes)

    const sourceMean = bytes.reduce((sum, byte) => sum + byte, 0) / (bytes.length * 255)
    const result = boxDownsampleGreyscale(source, width, heightPx, width / 2, heightPx / 2)
    const resultMean = Array.from(result).reduce((sum, value) => sum + value, 0) / result.length

    expect(resultMean).toBeCloseTo(sourceMean, 10)
  })

  it('нецелый коэффициент (Мимас 6356×3178 → потолок 2048 не делит нацело): дробное перекрытие, не молчаливое округление', () => {
    // источник 3×1, выход 2×1 — скейл 1.5 (та же природа несоответствия, что
    // у реальных входов батча). Окно пикселя 0: [0, 1.5) → индекс0 вес1,
    // индекс1 вес0.5 → (0·1 + 90·0.5)/1.5 = 30. Окно пикселя 1: [1.5, 3) →
    // индекс1 вес0.5, индекс2 вес1 → (90·0.5 + 180·1)/1.5 = 150.
    const source = Buffer.from([0, 90, 180])

    const result = boxDownsampleGreyscale(source, 3, 1, 2, 1)

    expect(result[0]).toBeCloseTo(30 / 255, 6)
    expect(result[1]).toBeCloseTo(150 / 255, 6)
  })

  it('нецелый коэффициент сохраняет общее среднее (энергию сигнала), как и целый', () => {
    const width = 9
    const bytes = Array.from({ length: width }, (_, i) => (i * 23) % 256)
    const source = Buffer.from(bytes)

    const sourceMean = bytes.reduce((sum, byte) => sum + byte, 0) / (bytes.length * 255)
    const result = boxDownsampleGreyscale(source, width, 1, 4, 1) // скейл 2.25 — нецелый
    const resultMean = Array.from(result).reduce((sum, value) => sum + value, 0) / result.length

    expect(resultMean).toBeCloseTo(sourceMean, 10)
  })

  it('2D нецелый скейл по ОБЕИМ осям (6×3 → 4×2, скейлX=скейлY=1.5) — Y считается честно, не только X', () => {
    // Каждая строка источника константна по X (0 / 200 / 100), поэтому X-веса
    // не влияют на результат (Σwx по любому целевому столбцу = scaleX=1.5 —
    // тождество вне зависимости от раскладки), и тест изолированно проверяет
    // ИМЕННО Y-раскладку — на эквиректангулярной карте Y это широта, битый
    // Y-путь молча смазал бы широтные полосы.
    //
    // Y-окна (скейл 1.5): целевая строка0 = [0, 1.5) → индекс0 вес1, индекс1
    // вес0.5; целевая строка1 = [1.5, 3) → индекс1 вес0.5, индекс2 вес1.
    // Блендинг по руке: строка0 = (0·1 + 200·0.5)/1.5 = 100/1.5 ≈ 66.667;
    // строка1 = (200·0.5 + 100·1)/1.5 = 200/1.5 ≈ 133.333.
    const source = Buffer.from([
      0, 0, 0, 0, 0, 0,
      200, 200, 200, 200, 200, 200,
      100, 100, 100, 100, 100, 100
    ])

    const result = boxDownsampleGreyscale(source, 6, 3, 4, 2)

    const expectedRow0 = 100 / 1.5 / 255
    const expectedRow1 = 200 / 1.5 / 255
    for (let x = 0; x < 4; x++) expect(result[x]).toBeCloseTo(expectedRow0, 6)
    for (let x = 0; x < 4; x++) expect(result[4 + x]).toBeCloseTo(expectedRow1, 6)
  })
})
