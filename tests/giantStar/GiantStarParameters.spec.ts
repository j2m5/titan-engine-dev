import { describe, it, expect } from 'vitest'
import { Actor } from '@/core/models/Actor'
import {
  giantStarParameters,
  giantStarCellEnergy,
  giantStarIntensity,
  GIANT_STAR_DEFAULT_TEMPERATURE_K,
  GIANT_STAR_DISPLAY_SCALE,
  GIANT_STAR_CELL_SPREAD_K
} from '@/core/renderables/GiantStar/GiantStarParameters'
import {
  COLOR_TEMPERATURE_FLOOR_K,
  STAR_CORE_INTENSITY,
  visibleBandRadianceRatio
} from '@/core/materials/shaders/lib/helpers'

function stubActor(data: object | null, temperature?: number): Actor {
  return {
    getAttribute: (_key: string, def?: unknown): unknown => def,
    renderingObject: data === null ? null : { getAttribute: () => data },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'temperature' && temperature ? temperature : def)
    }
  } as unknown as Actor
}

describe('giantStarParameters — дефолты', () => {
  it('пустые данные дают дефолты спеки', () => {
    expect(giantStarParameters(stubActor({}))).toEqual({
      temperature: GIANT_STAR_DEFAULT_TEMPERATURE_K,
      seed: 1,
      cellCount: 5,
      cellContrast: 1,
      atmosphereHeight: 0.3,
      atmosphereDensity: 1,
      exposureBias: 1,
      spreadK: GIANT_STAR_CELL_SPREAD_K
    })
  })

  it('отсутствующий renderingObject не роняет чтение', () => {
    expect(giantStarParameters(stubActor(null)).cellCount).toBe(5)
  })

  it('нули переживают чтение — это точки отката', () => {
    const params = giantStarParameters(stubActor({ atmosphereDensity: 0, exposureBias: 0, cellContrast: 0 }))

    expect(params.atmosphereDensity).toBe(0)
    expect(params.exposureBias).toBe(0)
    expect(params.cellContrast).toBe(0)
  })
})

describe('giantStarParameters — клампы', () => {
  it('отрицательные множители зажимаются в ноль', () => {
    const params = giantStarParameters(stubActor({ exposureBias: -1, atmosphereDensity: -2, cellContrast: -3 }))

    expect(params.exposureBias).toBe(0)
    expect(params.atmosphereDensity).toBe(0)
    expect(params.cellContrast).toBe(0)
  })

  it('cellCount не опускается ниже единицы', () => {
    expect(giantStarParameters(stubActor({ cellCount: 0 })).cellCount).toBe(1)
  })

  it('протяжённость оболочки держится в рабочем отрезке', () => {
    // Ноль делит на ноль в шкале высот; выше 2 прокси теряет смысл
    expect(giantStarParameters(stubActor({ atmosphereHeight: 0 })).atmosphereHeight).toBe(0.01)
    expect(giantStarParameters(stubActor({ atmosphereHeight: 9 })).atmosphereHeight).toBe(2)
  })

  it('спред холодной звезды не уводит холодный стоп ниже пола палитры', () => {
    const params = giantStarParameters(stubActor({ cellContrast: 3 }, 1500))

    expect(params.temperature - params.spreadK).toBeGreaterThanOrEqual(COLOR_TEMPERATURE_FLOOR_K)
    expect(params.spreadK).toBe(500)
  })

  it('температура из данных не опускается ниже пола цветовой температуры', () => {
    // Заглушка считает falsy-температуру отсутствующей, поэтому 200, а не 0.
    // Ноль в данных переполнил бы exp в формуле лимба и дал бы NaN
    const params = giantStarParameters(stubActor({}, 200))

    expect(params.temperature).toBe(COLOR_TEMPERATURE_FLOOR_K)
    expect(params.spreadK).toBe(0)
  })

  it('спред масштабируется контрастом', () => {
    expect(giantStarParameters(stubActor({ cellContrast: 0.5 })).spreadK).toBe(350)
  })
})

describe('энергия ячеек', () => {
  it('базовый стоп равен единице ровно', () => {
    expect(giantStarCellEnergy(3700, 700)[1]).toBe(1)
  })

  it('W26: холодная ячейка впятеро тусклее базы, горячая втрое ярче', () => {
    const [cool, , hot] = giantStarCellEnergy(3700, 700)

    expect(cool).toBeCloseTo(0.19, 2)
    expect(hot).toBeCloseTo(3.09, 1)
  })

  it('нулевой спред вырождается в ровную поверхность', () => {
    expect(giantStarCellEnergy(3700, 0)).toEqual([1, 1, 1])
  })
})

describe('интенсивность', () => {
  it('собирается из видимой полосы, калибровки и ручки данных', () => {
    const params = giantStarParameters(stubActor({ exposureBias: 2 }))

    expect(giantStarIntensity(params)).toBeCloseTo(
      STAR_CORE_INTENSITY * visibleBandRadianceRatio(3700) * GIANT_STAR_DISPLAY_SCALE * 2,
      12
    )
  })

  it('поверхность гиганта честно тусклее солнечной на порядок', () => {
    expect(visibleBandRadianceRatio(3700)).toBeCloseTo(0.083, 3)
  })

  it('нулевая ручка гасит тело', () => {
    expect(giantStarIntensity(giantStarParameters(stubActor({ exposureBias: 0 })))).toBe(0)
  })
})
