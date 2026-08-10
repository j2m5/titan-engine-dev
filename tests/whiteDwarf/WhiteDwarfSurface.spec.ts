import { describe, it, expect } from 'vitest'
import { whiteDwarfSurface } from '@/core/materials/shaders/lib/chunks/WhiteDwarfSurface'
import {
  planckX,
  visibleBandRadianceRatio,
  colorTemperatureToRGB,
  normalizeColor,
  srgbColorToLinear,
  PLANCK_C2_NM_K,
  PLANCK_REFERENCE_WAVELENGTHS_NM,
  STAR_CORE_INTENSITY,
  DEFAULT_STAR_TEMPERATURE_K
} from '@/core/materials/shaders/lib/helpers'
import { WHITE_DWARF_DISPLAY_SCALE } from '@/core/renderables/WhiteDwarf/WhiteDwarfParameters'
import {
  wdLimb,
  wdShade,
  limbDarkeningCoefficient,
  WD_EDDINGTON_TAU,
  WD_HDR_CEILING,
  type Vec3
} from './whiteDwarfSurfaceMirror'

/** G29-38 — холодный карлик с диском обломков, Sirius B — горячий без диска */
const G29_38_K: number = 11820
const SIRIUS_B_K: number = 25200
/** Солнце: контрольная точка, где ответ известен из наблюдений */
const SUN_K: number = 5772

/** Линейный базовый цвет тела — ровно то, что кладёт в юниформ WhiteDwarfMaterial */
function baseColor(temperatureK: number): Vec3 {
  const c = srgbColorToLinear(normalizeColor(colorTemperatureToRGB(temperatureK)))

  return [c.r, c.g, c.b]
}

/** Интенсивность, как её считает материал: физика, калибровка, нейтральная экспозиция */
function coreIntensity(temperatureK: number): number {
  return STAR_CORE_INTENSITY * visibleBandRadianceRatio(temperatureK) * WHITE_DWARF_DISPLAY_SCALE
}

/** Каналы в центре диска (mu = 1, потемнения нет) уже после потолка HDR */
function displayedCentre(temperatureK: number): Vec3 {
  return wdShade(1, baseColor(temperatureK), planckX(temperatureK), coreIntensity(temperatureK))
}

/** Яркость Rec. 709 центра диска после потолка */
function clampedLuminance(temperatureK: number): number {
  const [r, g, b]: Vec3 = displayedCentre(temperatureK)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('wdLimb — лимбовое потемнение из Эддингтона-Барбье', () => {
  it('в центре диска потемнения нет РОВНО, а не приближённо', () => {
    // sOne считается тем же выражением, что sMu, именно ради этого равенства:
    // разойдись они в последнем бите — центр диска перестал бы быть единицей,
    // и яркость тела поехала бы вместе с температурой. Точка отката: если
    // здесь появится toBeCloseTo, значит sOne увели в отдельную константу
    expect(wdLimb(1, planckX(G29_38_K))).toEqual([1, 1, 1])
  })

  it('яркость монотонно падает от центра к лимбу', () => {
    const x: Vec3 = planckX(G29_38_K)
    const samples: number[] = [1, 0.8, 0.6, 0.4, 0.2, 0].map((mu: number) => wdLimb(mu, x)[1])

    samples.forEach((value: number, i: number) => {
      if (i > 0) expect(value).toBeLessThan(samples[i - 1])
    })
  })

  // Пины считаны по формуле при проектировании, а НЕ замерены на картинке.
  // Солнечная строка — единственная проверяемая извне: наблюдаемое линейное u
  // Солнца в зелёном около 0.65-0.75, и модель туда попадает без подгонки
  it.each([
    [SUN_K, 0.6713],
    [G29_38_K, 0.4488],
    [SIRIUS_B_K, 0.315]
  ])('u(%i K) в зелёном канале равен %f', (temperature: number, expected: number) => {
    expect(limbDarkeningCoefficient(planckX(temperature)[1])).toBeCloseTo(expected, 3)
  })

  it('чем горячее тело, тем ПЛОСЧЕ диск', () => {
    // Смысл всей замены STAR_LIMB_COEFF на формулу: константная тройка зашита
    // под одну температуру и такой зависимости не даёт
    const cool: number = limbDarkeningCoefficient(planckX(SUN_K)[1])
    const warm: number = limbDarkeningCoefficient(planckX(G29_38_K)[1])
    const hot: number = limbDarkeningCoefficient(planckX(SIRIUS_B_K)[1])

    expect(warm).toBeLessThan(cool)
    expect(hot).toBeLessThan(warm)
  })

  it('синий темнеет сильнее красного — кромка диска теплеет', () => {
    const [uR, uG, uB]: number[] = planckX(G29_38_K).map(limbDarkeningCoefficient)

    expect(uR).toBeLessThan(uG)
    expect(uG).toBeLessThan(uB)
  })

  it('в пределе Рэлея-Джинса потемнение выходит на 0.2047, а не на ноль', () => {
    // s(0)/s(1) = 0.7953: даже при линейной по T планковской функции остаётся
    // потемнение от самого перепада температуры с глубиной. Ноль здесь был бы
    // признаком того, что формулу заменили на I = 1 - u*(1 - mu)
    const u: number = limbDarkeningCoefficient(planckX(1e9)[1])

    expect(u).toBeCloseTo(0.2047, 4)
  })

  it('на всём физическом диапазоне карлика значения конечны и в (0, 1]', () => {
    // 4 kK — самый холодный известный карлик, 150 kK — только что родившийся.
    // Проверка на обусловленность: exp(x) - 1 теряет точность лишь при x много
    // меньше 1e-3, то есть выше 26 млн K — недостижимо
    for (let t = 4000; t <= 150000; t += 2000) {
      const x: Vec3 = planckX(t)

      for (const mu of [0, 0.001, 0.5, 1]) {
        wdLimb(mu, x).forEach((value: number) => {
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThan(0)
          expect(value).toBeLessThanOrEqual(1)
        })
      }
    }
  })
})

describe('wdShade — композиция тела', () => {
  it('потолок HDR держится и на горячем карлике', () => {
    const white: Vec3 = [1, 1, 1]
    const intensity: number = STAR_CORE_INTENSITY * visibleBandRadianceRatio(SIRIUS_B_K)

    wdShade(1, white, planckX(SIRIUS_B_K), intensity).forEach((value: number) => {
      expect(value).toBe(WD_HDR_CEILING)
    })
  })

  it('нулевая интенсивность гасит тело — точка отката', () => {
    expect(wdShade(1, [1, 1, 1], planckX(G29_38_K), 0)).toEqual([0, 0, 0])
  })
})

describe('planckX / visibleBandRadianceRatio — CPU-половина физики', () => {
  it('x считается через вторую радиационную постоянную', () => {
    const [, green]: Vec3 = planckX(SUN_K)

    expect(green).toBeCloseTo(PLANCK_C2_NM_K / (PLANCK_REFERENCE_WAVELENGTHS_NM[1] * SUN_K), 10)
    expect(green).toBeCloseTo(4.532, 3)
  })

  it('на опорной температуре отношение равно единице', () => {
    expect(visibleBandRadianceRatio(DEFAULT_STAR_TEMPERATURE_K)).toBeCloseTo(1, 12)
  })

  it('яркость растёт с температурой монотонно', () => {
    const samples: number[] = [4000, 8000, 12000, 25000, 60000, 150000].map((t: number) =>
      visibleBandRadianceRatio(t)
    )

    samples.forEach((value: number, i: number) => {
      if (i > 0) expect(value).toBeGreaterThan(samples[i - 1])
    })
  })

  it('G29-38 остаётся под потолком HDR, а Sirius B его пробивает', () => {
    // Это не совпадение и не подкрутка, а причина, по которой в базу заведена
    // именно эта пара: два объекта показывают оба режима. Холодный карлик —
    // читаемый диск с видимым потемнением, горячий — плоский выжженный круг.
    //
    // Сравниваются РЕАЛЬНЫЕ каналы в центре диска, а не одна интенсивность:
    // до цвета она домножается на базовую палитру, и у G29-38 самый яркий
    // канал втрое выше самого тусклого. Проверка по интенсивности прошла бы и
    // тогда, когда синий канал давно клипается
    expect(Math.max(...displayedCentre(G29_38_K))).toBeLessThan(WD_HDR_CEILING)
    expect(displayedCentre(SIRIUS_B_K).every((c: number) => c === WD_HDR_CEILING)).toBe(true)
  })

  it('калибровка сажает оба карлика ровно вдвое и сохраняет отношение между ними', () => {
    // Ни одна из двух правок по отдельности этого не даёт: половинный масштаб
    // не трогает горячего (он клипается), а опущенный потолок не трогает
    // холодного (он до него не достаёт). Работает только пара.
    //
    // Отношение яркостей карликов обязано выжить: иначе более горячий перестал
    // бы читаться как более яркий, и физика уступила бы место подкрутке
    const hot: number = clampedLuminance(SIRIUS_B_K)
    const cool: number = clampedLuminance(G29_38_K)

    expect(WHITE_DWARF_DISPLAY_SCALE).toBe(0.5)
    expect(hot).toBeCloseTo(WD_HDR_CEILING, 6)
    expect(hot / cool).toBeCloseTo(2.04, 1)
  })

  it('закон Стефана-Больцмана дал бы завышение в разы', () => {
    // T^4 болометричен, и у карлика он почти весь в EUV, которого камера не
    // видит. Если этот тест упал в сторону единицы — значит яркость снова
    // считают четвёртой степенью
    const planck: number = visibleBandRadianceRatio(SIRIUS_B_K)
    const stefanBoltzmann: number = Math.pow(SIRIUS_B_K / DEFAULT_STAR_TEMPERATURE_K, 4)

    expect(stefanBoltzmann / planck).toBeGreaterThan(6)
  })
})

describe('чанк whiteDwarfSurface — структура', () => {
  it('числовые константы GLSL синхронизированы с зеркалом', () => {
    expect(whiteDwarfSurface).toContain(`#define WD_EDDINGTON_TAU ${WD_EDDINGTON_TAU}`)
    expect(whiteDwarfSurface).toContain(`#define WD_HDR_CEILING ${WD_HDR_CEILING.toFixed(1)}`)
  })

  it('sOne в GLSL считается выражением, а не литералом', () => {
    expect(whiteDwarfSurface).toContain('float sOne = pow(0.75 * (1.0 + WD_EDDINGTON_TAU), 0.25);')
  })

  it('на поверхности нет шума — его физически нечему создавать', () => {
    // Грануляция у карлика не разрешается никогда (гранула ~1/6000 радиуса), а
    // у горячих конвекции нет вовсе. Появление здесь snoise/fbm означает, что
    // тело начали рисовать как маленькую звезду
    expect(whiteDwarfSurface).not.toMatch(/snoise|fbm/)
  })

  it('чанк не зависит от других чанков', () => {
    expect(whiteDwarfSurface).not.toContain('#include')
  })
})
