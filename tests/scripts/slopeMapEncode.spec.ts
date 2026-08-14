import { describe, expect, it } from 'vitest'
import { buildSlopeMap, SLOPE_RANGE } from '../../scripts/lib/slopeMapEncode'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

// min 0, max 65535 → метры численно равны raw-значению
function makeMap(width: number, height: number, values: number[]): HeightMapData {
  return { width, height, minMeters: 0, maxMeters: 65535, data: new Uint16Array(values) }
}

function decode(byte: number): number {
  return ((byte - 128) / 127) * SLOPE_RANGE
}

/** Широта центра строки по полутексельной конвенции GPU: строка 0 — север. */
function rowLatitude(y: number, height: number): number {
  return Math.PI / 2 - ((y + 0.5) / height) * Math.PI
}

describe('buildSlopeMap: честные уклоны из карты высот', () => {
  const R = 1000

  it('плоская карта кодируется нейтральным байтом 128, синий канал нулевой', () => {
    const rgb = buildSlopeMap(makeMap(4, 2, new Array(8).fill(30000)), R)

    expect(rgb.length).toBe(4 * 2 * 3)
    for (let i = 0; i < rgb.length; i += 3) {
      expect(rgb[i]).toBe(128)
      expect(rgb[i + 1]).toBe(128)
      expect(rgb[i + 2]).toBe(0)
    }
  })

  it('восточный подъём даёт уклон Δh на длину дуги данной широты', () => {
    // строка y=1 из четырёх: широта 22.5°; высоты растут на 100 м/тексель
    const width = 8
    const height = 4
    const values = new Array(width * height).fill(0)
    for (let x = 0; x < width; x++) values[1 * width + x] = 100 * x

    const rgb = buildSlopeMap(makeMap(width, height, values), R)

    const eastArc = (2 * Math.PI * R * Math.cos(rowLatitude(1, height))) / width
    const expected = (100 * 2) / (2 * eastArc)
    expect(decode(rgb[(1 * width + 3) * 3])).toBeCloseTo(expected, 1)
  })

  it('арки честные: тот же подъём ближе к полюсу круче в cos(широты) раз', () => {
    const width = 8
    const height = 4
    const values = new Array(width * height).fill(0)
    for (let x = 0; x < width; x++) {
      values[0 * width + x] = 100 * x // широта 67.5°
      values[1 * width + x] = 100 * x // широта 22.5°
    }

    const rgb = buildSlopeMap(makeMap(width, height, values), R)

    const nearPole = decode(rgb[(0 * width + 3) * 3])
    const nearEquator = decode(rgb[(1 * width + 3) * 3])
    const ratio = Math.cos(rowLatitude(1, height)) / Math.cos(rowLatitude(0, height))
    // точность 0: квантование в 8 бит размывает отношение, но нечестные арки
    // (без деления на cos широты) дали бы отношение ровно 1 — различимо с запасом
    expect(nearPole / nearEquator).toBeCloseTo(ratio, 0)
  })

  it('шов долготы заворачивается: сосед текселя x=0 — последний столбец', () => {
    // одинокий пик в последнем столбце: у x=0 западный сосед высокий → уклон на восток отрицателен...
    // сосед слева (запад) = столбец 3: h=1000, сосед справа = столбец 1: h=0
    const rgb = buildSlopeMap(makeMap(4, 2, [0, 0, 0, 1000, 0, 0, 0, 1000]), R)

    const eastArc = (2 * Math.PI * R * Math.cos(rowLatitude(0, 2))) / 4
    const expected = (0 - 1000) / (2 * eastArc)
    const clamped = Math.max(-SLOPE_RANGE, Math.min(SLOPE_RANGE, expected))
    expect(decode(rgb[0])).toBeCloseTo(clamped, 1)
  })

  it('северный подъём кодируется в зелёный канал со знаком «плюс — к северу»', () => {
    // строка 0 (север) выше строки 2 (юг): в строке 1 уклон к северу положителен
    const width = 2
    const height = 4
    const values = [400, 400, 200, 200, 0, 0, 0, 0]

    const rgb = buildSlopeMap(makeMap(width, height, values), R)

    const northArc = (Math.PI * R) / height
    const expected = (400 - 0) / (2 * northArc)
    expect(decode(rgb[(1 * width + 0) * 3 + 1])).toBeCloseTo(expected, 2)
  })

  it('полярные строки клампят соседа по широте и не падают', () => {
    const width = 2
    const height = 4
    const values = [400, 400, 100, 100, 0, 0, 0, 0]

    const rgb = buildSlopeMap(makeMap(width, height, values), R)

    // строка 0: северный сосед клампится в саму строку 0 → (h0 − h1) / (2·arc)
    const northArc = (Math.PI * R) / height
    const expected = (400 - 100) / (2 * northArc)
    expect(decode(rgb[1])).toBeCloseTo(expected, 2)
  })

  it('уклон круче диапазона клампится в крайние байты, без переполнения', () => {
    // перепады в десятки км на тексель при R=1000 — уклон далеко за ±SLOPE_RANGE
    const row = [0, 30000, 60000, 30000]
    const rgb = buildSlopeMap(makeMap(4, 2, [...row, ...row]), R)

    expect(rgb[1 * 3]).toBe(255) // x=1: подъём с 0 до 60000
    expect(rgb[3 * 3]).toBe(1) // x=3: спуск с 60000 до 0 (через шов)
  })

  it('невалидный радиус — ошибка с внятным сообщением', () => {
    const map = makeMap(2, 2, [0, 0, 0, 0])

    expect(() => buildSlopeMap(map, 0)).toThrow(/радиус/i)
    expect(() => buildSlopeMap(map, NaN)).toThrow(/радиус/i)
  })
})
