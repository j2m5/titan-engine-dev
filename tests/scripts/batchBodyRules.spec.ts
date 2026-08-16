import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { bandLowKmFor, boxDownsampleGreyscale, resolutionCeiling } from '../../scripts/lib/batchBodyRules'

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
})
