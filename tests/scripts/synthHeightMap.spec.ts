import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildElevationHeightField, buildSynthHeightField, type SynthHeightParams } from '../../scripts/lib/synthHeightMap'
import { encodeHeightMap, normalizeToUint16 } from '../../scripts/lib/heightMapEncode'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'

/**
 * Радиус подобран так, что 1 км трассы ровно равен 1 текселю экватора
 * (σ_текселей = км·1000 / (2π·R/width), при R = 1000·width/(2π) знаменатель
 * = 1000 → σ_текселей = км). Это делает band-low-km/band-high-km в тестах
 * численно равными сигмам в текселях без промежуточной арифметики.
 */
function radiusForOneKmPerTexel(width: number): number {
  return (1000 * width) / (2 * Math.PI)
}

function baseParams(width: number, height: number): SynthHeightParams {
  return {
    widthTexels: width,
    heightTexels: height,
    radiusMeters: radiusForOneKmPerTexel(width),
    seed: 1,
    baseAmplitudeMeters: 0,
    bumpAmplitudeMeters: 1000,
    bandLowKm: 16,
    bandHighKm: 0.5,
    bumpSign: 1,
    raw: false
  }
}

describe('buildSynthHeightField: p99-нормировка', () => {
  it('одиночный выброс не сжимает рельеф (амплитуда вдали от выброса меняется < 5%)', () => {
    // 512×256 (не 256×128): footprint выброса после тройного box-блюра (σ_low=16,
    // опора 3·16=48 текселей на каждую сторону) — величина ФИКСИРОВАННАЯ в текселях,
    // не зависит от размера карты. На 256×128 (32768 текселей) опора ~97×97 —
    // это ~29% всех текселей, и локальная просадка band внутри опоры ощутимо
    // двигает 99-й процентиль ПО ВСЕЙ карте (эмпирически ~4.4% — технически
    // проходит порог 0.05, но с неубедительным запасом). На 512×256 (131072
    // текселя) та же абсолютная опора — уже ~7% текселей, и порог держится с
    // огромным запасом (эмпирически ~0.0004%) — честная демонстрация свойства
    // «p99, а не max, не даёт единичному выбросу сжать типичный рельеф», а не
    // случайное попадание в допуск на грани.
    const width = 512
    const height = 256
    const period = 8 // короче σ_low=16, длиннее σ_high=0.5 — в полосе
    const spikeRow = height / 2 // экватор — минимальное 1/cos-уширение EW-радиуса
    const spikeCol = width / 2

    const clean = new Float64Array(width * height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) clean[y * width + x] = 0.3 * Math.sin((2 * Math.PI * x) / period)

    const spiked = clean.slice()
    spiked[spikeRow * width + spikeCol] = 100.0

    const params = baseParams(width, height)
    const cleanResult = buildSynthHeightField(clean, params)
    const spikedResult = buildSynthHeightField(spiked, params)

    // измеряем на ТОЙ ЖЕ (экваториальной) строке, что и спайк — так пиковая
    // амплитуда сине-волны не искажена полярным 1/cos-уширением EW-радиуса
    // (искажение — свойство самой широты, не спайка); x∈[0,80) — вне опоры
    // спайка (|x−spikeCol|≥176 ≫ 48) при обёртке долготы
    const farAmplitude = (heights: Float64Array): number => {
      let lo = Infinity
      let hi = -Infinity
      for (let x = 0; x < 80; x++) {
        const v = heights[spikeRow * width + x]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      return hi - lo
    }

    const cleanAmp = farAmplitude(cleanResult.heights)
    const spikedAmp = farAmplitude(spikedResult.heights)

    expect(cleanAmp).toBeGreaterThan(0)
    expect(Math.abs(spikedAmp - cleanAmp) / cleanAmp).toBeLessThan(0.05)
  })
})

describe('buildSynthHeightField: bumpSign', () => {
  it('bumpSign = -1 флипает знак band-состава (амплитуда подложки исключена нулём)', () => {
    const width = 256
    const height = 128
    const period = 8

    const luminance = new Float64Array(width * height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) luminance[y * width + x] = 0.3 * Math.sin((2 * Math.PI * x) / period)

    const positive = buildSynthHeightField(luminance, { ...baseParams(width, height), bumpSign: 1 })
    const negative = buildSynthHeightField(luminance, { ...baseParams(width, height), bumpSign: -1 })

    for (let i = 0; i < luminance.length; i++) {
      expect(negative.heights[i]).toBeCloseTo(-positive.heights[i], 9)
    }
  })
})

describe('buildSynthHeightField: --raw', () => {
  it('высоты = яркость × амплитуда × знак + 0 подложки (байт-в-байт формула)', () => {
    const luminance = new Float64Array([0, 0.25, 0.5, 1])
    const params: SynthHeightParams = {
      widthTexels: 2,
      heightTexels: 2,
      radiusMeters: 1_000_000,
      seed: 5,
      baseAmplitudeMeters: 800, // должен быть проигнорирован в raw-режиме
      bumpAmplitudeMeters: 3000,
      bandLowKm: 1500,
      bandHighKm: 30,
      bumpSign: -1,
      raw: true
    }

    const { heights } = buildSynthHeightField(luminance, params)

    for (let i = 0; i < luminance.length; i++) {
      expect(heights[i]).toBe(luminance[i] * params.bumpAmplitudeMeters * params.bumpSign)
    }
  })
})

describe('buildSynthHeightField: диапазон заголовка', () => {
  it('min/max = фактический диапазон поля', () => {
    const luminance = new Float64Array([0, 0.5, 1, 0.2])
    const params: SynthHeightParams = {
      widthTexels: 2,
      heightTexels: 2,
      radiusMeters: 1_000_000,
      seed: 3,
      baseAmplitudeMeters: 0,
      bumpAmplitudeMeters: 10,
      bandLowKm: 1500,
      bandHighKm: 30,
      bumpSign: 1,
      raw: true
    }

    const { heights, minMeters, maxMeters } = buildSynthHeightField(luminance, params)

    expect(minMeters).toBe(Math.min(...heights))
    expect(maxMeters).toBe(Math.max(...heights))
  })
})

describe('buildElevationHeightField: честная карта высот', () => {
  const width = 64
  const height = 32

  /** Яркость [0..1] с крупной структурой — не константа, иначе нормировка вырождена. */
  function elevationLuminance(): Float64Array {
    const out = new Float64Array(width * height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        out[y * width + x] = 0.5 + 0.3 * Math.sin((2 * Math.PI * x) / width) + 0.15 * Math.cos((2 * Math.PI * y) / height)

    return out
  }

  it('пик поля равен peakMeters — амплитуду задаёт бюджет, не RMS-калибровка', () => {
    const { minMeters, maxMeters } = buildElevationHeightField(elevationLuminance(), {
      widthTexels: width,
      heightTexels: height,
      peakMeters: 8318,
      smoothSigmaTexels: 0.7
    })

    expect(Math.max(Math.abs(minMeters), Math.abs(maxMeters))).toBeCloseTo(8318, 6)
  })

  it('среднее поля ≈ 0 — вычтено среднее яркости, а не подобран уровень', () => {
    const { heights, maxMeters } = buildElevationHeightField(elevationLuminance(), {
      widthTexels: width,
      heightTexels: height,
      peakMeters: 8318,
      smoothSigmaTexels: 0.7
    })

    const mean = heights.reduce((sum, v) => sum + v, 0) / heights.length
    expect(Math.abs(mean)).toBeLessThan(0.01 * maxMeters)
  })

  it('монотонность: ярче → выше (без сглаживания порядок текселей сохранён)', () => {
    const luminance = new Float64Array(width * height)
    for (let i = 0; i < luminance.length; i++) luminance[i] = i / (luminance.length - 1)

    const { heights } = buildElevationHeightField(luminance, {
      widthTexels: width,
      heightTexels: height,
      peakMeters: 1000,
      smoothSigmaTexels: 0
    })

    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThan(heights[i - 1])
  })

  it('сглаживание срезает 8-битную ступеньку: соседний скачок меньше, чем без него', () => {
    const luminance = new Float64Array(width * height)
    for (let y = 0; y < height; y++) for (let x = width / 2; x < width; x++) luminance[y * width + x] = 1

    const params = { widthTexels: width, heightTexels: height, peakMeters: 1000 }
    const crisp = buildElevationHeightField(luminance, { ...params, smoothSigmaTexels: 0 })
    const smooth = buildElevationHeightField(luminance, { ...params, smoothSigmaTexels: 0.7 })

    const rowJump = (heights: Float64Array): number => {
      const row = height / 2
      return Math.abs(heights[row * width + width / 2] - heights[row * width + width / 2 - 1])
    }

    expect(rowJump(smooth.heights)).toBeLessThan(rowJump(crisp.heights))
  })

  it('min/max — фактический диапазон поля', () => {
    const { heights, minMeters, maxMeters } = buildElevationHeightField(elevationLuminance(), {
      widthTexels: width,
      heightTexels: height,
      peakMeters: 500,
      smoothSigmaTexels: 0.7
    })

    expect(minMeters).toBe(Math.min(...heights))
    expect(maxMeters).toBe(Math.max(...heights))
  })

  it('детерминизм: два прогона байт-в-байт совпадают', () => {
    const luminance = elevationLuminance()
    const params = { widthTexels: width, heightTexels: height, peakMeters: 8318, smoothSigmaTexels: 0.7 }

    expect(Array.from(buildElevationHeightField(luminance, params).heights)).toEqual(
      Array.from(buildElevationHeightField(luminance, params).heights)
    )
  })

  it('длина яркости не сходится с width×height — ошибка, а не молчаливый мусор', () => {
    expect(() =>
      buildElevationHeightField(new Float64Array(10), {
        widthTexels: width,
        heightTexels: height,
        peakMeters: 1000,
        smoothSigmaTexels: 0.7
      })
    ).toThrow()
  })
})

describe('интеграция: синтетическая карта → TEHM → TerrainHeightField', () => {
  it('строится без NaN, ε(1..6) конечны, clearanceMeters конечен (block>1 путь буфера провиса)', () => {
    // 1536×768: block = round(width/CLEARANCE_GRID_BASE_SEGMENTS) = round(1536/1024) = 2 (>1) —
    // тексель 64×32 из брифа даёт block=1 при константе 1024 (round(64/1024)=0→max(1,0)=1),
    // проверка "block>1 путь" при этой константе требует карты крупнее ~512 текселей;
    // размер увеличен намеренно (сохранена 2:1 пропорция и оффлайн-путь синтетики,
    // без чтения файла), чтобы честно упражнять ветку block>1.
    const width = 1536
    const height = 768

    const luminance = new Float64Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        luminance[y * width + x] =
          0.5 + 0.3 * Math.sin((2 * Math.PI * x * 6) / width) + 0.15 * Math.cos((2 * Math.PI * y * 4) / height)
      }
    }

    const radiusMeters = 2_410_300 // Каллисто, пилот арки
    const params: SynthHeightParams = {
      widthTexels: width,
      heightTexels: height,
      radiusMeters,
      seed: 23,
      baseAmplitudeMeters: 800,
      bumpAmplitudeMeters: 3000,
      bandLowKm: 1500,
      bandHighKm: 30,
      bumpSign: 1,
      raw: false
    }

    const { heights, minMeters, maxMeters } = buildSynthHeightField(luminance, params)
    const data = normalizeToUint16(Float32Array.from(heights), minMeters, maxMeters)
    const buffer = encodeHeightMap({ width, height, minMeters, maxMeters, data })
    const parsed = parseHeightMap(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)

    const field = new TerrainHeightField(parsed, radiusMeters / 1000)

    for (let level = 1; level <= 6; level++) {
      expect(Number.isFinite(field.geometricErrorMeters(level))).toBe(true)
    }

    const dirs = [
      new Vector3(0, 1, 0), // северный полюс
      new Vector3(0, -1, 0), // южный полюс
      new Vector3(1, 0, 0),
      new Vector3(-1, 0, 0),
      new Vector3(0, 0, 1),
      new Vector3(0.6, 0.6, 0.53).normalize()
    ]

    for (const dir of dirs) {
      expect(Number.isNaN(field.clearanceMeters(dir))).toBe(false)
      expect(Number.isFinite(field.clearanceMeters(dir))).toBe(true)
      expect(Number.isFinite(field.heightMeters(dir))).toBe(true)
    }
  })
})
