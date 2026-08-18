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

  it('плоская карта кодируется нейтральным байтом 128 на R/G; с cavity:false синий канал нулевой', () => {
    // точное равенство переживает дизер намеренно: честный ноль квантуется в
    // целое число МЗР без остатка, а дизер добавляет смещение из [-0.5, 0.5) —
    // round(n + u) для целого n и u из этого интервала всегда возвращает n
    // (интервал целиком лежит в одной корзине округления). Дизер рассеивает
    // только ДРОБНУЮ часть кванта — см. describe('дизер квантования') ниже
    const rgb = buildSlopeMap(makeMap(4, 2, new Array(8).fill(30000)), R, { cavity: false })

    expect(rgb.length).toBe(4 * 2 * 3)
    for (let i = 0; i < rgb.length; i += 3) {
      expect(rgb[i]).toBe(128)
      expect(rgb[i + 1]).toBe(128)
      expect(rgb[i + 2]).toBe(0)
    }
  })

  it('плоская карта с cavity (дефолт): B тоже нейтральный байт 128, а не 0 — полости на плоском поле нет, но канал заполнен', () => {
    // плоское поле → buildCavityField даёт честный ноль (см. cavityMap.spec.ts),
    // а encode(0, ...) квантуется в 128 тем же путём, что и R/G
    const rgb = buildSlopeMap(makeMap(4, 2, new Array(8).fill(30000)), R)

    for (let i = 0; i < rgb.length; i += 3) expect(rgb[i + 2]).toBe(128)
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
    // точность 1, не 2: дизер стохастически округляет дробную часть кванта,
    // единичный тексель может уйти в соседний байт (шум до 1 МЗР ≈ 0.0157)
    expect(decode(rgb[(1 * width + 0) * 3 + 1])).toBeCloseTo(expected, 1)
  })

  it('полярные строки: односторонняя разность делится на фактический пролёт, а не на 2 строки', () => {
    const width = 2
    const height = 4
    const values = [400, 400, 100, 100, 0, 0, 0, 0]

    const rgb = buildSlopeMap(makeMap(width, height, values), R)

    // строка 0: северный сосед клампится в саму строку 0, пролёт — одна строка
    const northArc = (Math.PI * R) / height
    const expected = (400 - 100) / (1 * northArc)
    // точность 1: та же причина, см. тест выше
    expect(decode(rgb[1])).toBeCloseTo(expected, 1)
  })

  it('у полюсов базис восточной разности расширяется до метрической длины экватора', () => {
    // строка 0 (широта 78.75°): 1/cos ≈ 5.1 → пролёт ±4 текселя (кламп width/4).
    // Без расширения одиночный пик в 1000 м на дуге 77 м сатурировал бы кламп —
    // ровно тот полярный шум, который увидел бы игрок над полюсом.
    const width = 16
    const height = 8
    const values = new Array(width * height).fill(0)
    values[8] = 1000

    const rgb = buildSlopeMap(makeMap(width, height, values), R)

    const eastArc = (2 * Math.PI * R * Math.cos(rowLatitude(0, height))) / width
    const span = 4
    const expected = 1000 / (2 * span * eastArc)
    expect(decode(rgb[4 * 3])).toBeCloseTo(expected, 1)

    for (let x = 0; x < width; x++) {
      expect(rgb[x * 3]).not.toBe(255)
      expect(rgb[x * 3]).not.toBe(1)
    }
  })

  it('уклон круче диапазона клампится в крайние байты, без переполнения', () => {
    // перепады в десятки км на тексель при R=1000 — уклон далеко за ±SLOPE_RANGE
    // физический кламп даёт целое число МЗР (±127) — та же устойчивость к
    // дизеру, что и у честного нуля выше, крайние байты остаются точными
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

describe('паритет { cavity: false } с реализацией ДО появления канала B', () => {
  // Эталон зафиксирован ДО правки энкодера (честный RED): запущен текущий на
  // тот момент buildSlopeMap на рукодельной карте 6×4 с неоднородным рельефом
  // (data[i] = round(5000 + 1000·sin(0.7x + 1.3y) + 500y + 200x)), радиус
  // 4000 м — байты скопированы из фактического вывода один в один.
  const width = 6
  const height = 4
  const data = [
    5000, 5844, 6385, 6463, 6135, 5649, 6464, 6609, 6327, 5844, 5482, 5504, 6516, 6042, 5643, 5600, 6027, 6818, 5812,
    5706, 6068, 6821, 7705, 8399,
  ]
  const expectedRgb = [
    131, 99, 0, 155, 113, 0, 140, 130, 0, 123, 141, 0, 112, 141, 0, 106, 131, 0, 137, 113, 0, 127, 126, 0, 122, 135,
    0, 121, 136, 0, 125, 129, 0, 136, 116, 0, 122, 135, 0, 121, 137, 0, 124, 130, 0, 132, 118, 0, 138, 106, 0, 132,
    99, 0, 75, 142, 0, 133, 135, 0, 150, 120, 0, 161, 103, 0, 159, 94, 0, 90, 96, 0,
  ]

  it('{ cavity: false } воспроизводит эталон байт-в-байт (R/G как раньше, B нулевой)', () => {
    const map = makeMap(width, height, data)
    const rgb = buildSlopeMap(map, 4000, { cavity: false })

    expect(Array.from(rgb)).toEqual(expectedRgb)
  })

  it('дефолт (без options) отличается от паритетного эталона только каналом B', () => {
    const map = makeMap(width, height, data)
    const rgb = buildSlopeMap(map, 4000)

    for (let i = 0; i < rgb.length; i += 3) {
      expect(rgb[i]).toBe(expectedRgb[i]) // R не тронут
      expect(rgb[i + 1]).toBe(expectedRgb[i + 1]) // G не тронут
    }
    // B не константа 0 на неоднородном рельефе (иначе cavity не запёкся)
    const bChannel = Array.from(rgb).filter((_, idx) => idx % 3 === 2)
    expect(bChannel.some((b) => b !== 0)).toBe(true)
  })
})

describe('дизер квантования: субквантовый сигнал не теряется целиком', () => {
  // широта 22.5° (rowY=2 из 4) — eastSpan=1, как в «арки честные» выше;
  // R и шаг высоты подобраны так, чтобы сырой уклон был меньше 0.5 МЗР —
  // до дизера round() дал бы 128 НА КАЖДОМ текселе константного поля
  const width = 2000
  const height = 4
  const rowY = 2
  const bodyRadius = 100000
  const deltaPerX = 1 // м/тексель — целые высоты Uint16, дробный уклон получается из геометрии дуги

  function constantSlopeMap(): HeightMapData {
    const values = new Array(width * height).fill(0)
    for (let x = 0; x < width; x++) values[rowY * width + x] = deltaPerX * x
    return makeMap(width, height, values)
  }

  // интерьер без крайних столбцов: у x=0 и x=width−1 сосед через шов долготы
  // рвёт линейную рампу скачком на всю высоту поля — не о дизере тест
  function meanDecodedEastSlope(rgb: Uint8Array): number {
    let sum = 0
    let count = 0
    for (let x = 1; x < width - 1; x++) {
      sum += decode(rgb[(rowY * width + x) * 3])
      count++
    }
    return sum / count
  }

  it('постоянный уклон ниже кванта: среднее по большой области ловит истинную величину (без дизера было бы 0)', () => {
    const eastArc = (2 * Math.PI * bodyRadius * Math.cos(rowLatitude(rowY, height))) / width
    const expected = deltaPerX / eastArc

    // сырое значение до округления должно лежать строго внутри «мёртвой»
    // корзины [0, 0.5) МЗР — иначе тест проверяет не то явление
    expect(expected).toBeLessThan(SLOPE_RANGE / 254)

    const rgb = buildSlopeMap(constantSlopeMap(), bodyRadius)
    const mean = meanDecodedEastSlope(rgb)

    expect(Math.abs(mean - expected)).toBeLessThan(Math.abs(expected) * 0.1)
  })

  it('дизер не смещает среднее: разные дробные части кванта дают несмещённую оценку', () => {
    // deltaPerX=25 даёт дробную часть МЗР около 0.5 — точка максимальной
    // неопределённости округления, где систематическое смещение (если бы оно
    // было) проявилось бы сильнее всего
    const biasedDeltaPerX = 25
    const values = new Array(width * height).fill(0)
    for (let x = 0; x < width; x++) values[rowY * width + x] = biasedDeltaPerX * x
    const eastArc = (2 * Math.PI * bodyRadius * Math.cos(rowLatitude(rowY, height))) / width
    const expected = biasedDeltaPerX / eastArc

    const rgb = buildSlopeMap(makeMap(width, height, values), bodyRadius)
    let sum = 0
    let count = 0
    for (let x = 1; x < width - 1; x++) {
      sum += decode(rgb[(rowY * width + x) * 3])
      count++
    }
    const mean = sum / count

    expect(Math.abs(mean - expected)).toBeLessThan(Math.abs(expected) * 0.05)
  })
})

describe('канал B: signed cavity, знак соответствует buildCavityField', () => {
  it('яма темнее нейтрали (байт < 128), гребень светлее (байт > 128) в центре каждой формы', () => {
    const bodyRadius = 1000
    const width = 512
    const height = 256
    const cx = 256
    const cy = 128
    const sigma = 3
    const baseline = 30000
    const amplitude = 20000

    const pitValues = new Array(width * height)
    const bumpValues = new Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx
        const dy = y - cy
        const g = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
        pitValues[y * width + x] = Math.round(baseline - amplitude * g)
        bumpValues[y * width + x] = Math.round(baseline + amplitude * g)
      }
    }

    const pitRgb = buildSlopeMap(makeMap(width, height, pitValues), bodyRadius)
    const bumpRgb = buildSlopeMap(makeMap(width, height, bumpValues), bodyRadius)

    const centerIdx = (cy * width + cx) * 3 + 2
    expect(pitRgb[centerIdx]).toBeLessThan(128)
    expect(bumpRgb[centerIdx]).toBeGreaterThan(128)
  })
})
