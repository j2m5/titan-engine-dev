import { describe, expect, it } from 'vitest'
import {
  MACRO_FADE_TEXEL_FACTOR,
  MACRO_RELIEF_ASPECT,
  STREAK_STRETCH,
  TERRACE_RISER,
  cavityGain,
  distFade,
  macroFadeMetersFor,
  macroTiltRadians,
  octaveWeight,
  slopeGain,
  structureGate,
  terraceCoverage,
  terraceProfile,
  triplanarWeights,
  streakGradient2D
} from '@/core/materials/shaders/lib/chunks/terrainMacroDetailMath'

describe('terrainMacroDetailMath: конец fade от радиуса и ширины диффуза', () => {
  it('Земля/8192: тексель 4.89 км × фактор — тысячи километров', () => {
    const meters = macroFadeMetersFor(6371, 8192)
    const texelMeters = (2 * Math.PI * 6371 * 1000) / 8192
    expect(meters).toBeCloseTo(texelMeters * MACRO_FADE_TEXEL_FACTOR, 6)
    expect(meters).toBeGreaterThan(5e6)
    expect(meters).toBeLessThan(1e7)
  })

  it('пропорционален радиусу и обратно пропорционален ширине карты', () => {
    expect(macroFadeMetersFor(1737, 8192) / macroFadeMetersFor(6371, 8192)).toBeCloseTo(1737 / 6371, 9)
    expect(macroFadeMetersFor(6371, 4096) / macroFadeMetersFor(6371, 8192)).toBeCloseTo(2, 9)
  })

  it('нулевой радиус или ширина — 0 (стаб-актор без physicalObject, карта не загружена)', () => {
    expect(macroFadeMetersFor(0, 8192)).toBe(0)
    expect(macroFadeMetersFor(6371, 0)).toBe(0)
  })
})

describe('terrainMacroDetailMath: гашение октав и fade', () => {
  it('octaveWeight: 1 при следе 0, 0 при footprint·f ≥ 1, монотонно', () => {
    expect(octaveWeight(0, 1)).toBe(1)
    expect(octaveWeight(0.5, 1)).toBe(1)
    expect(octaveWeight(1, 1)).toBe(0)
    expect(octaveWeight(0.25, 4)).toBe(0)
    expect(octaveWeight(0.6, 1)).toBeGreaterThan(octaveWeight(0.8, 1))
  })

  it('distFade: 1 до 0.4·end, 0 за end', () => {
    expect(distFade(0, 100)).toBe(1)
    expect(distFade(40, 100)).toBe(1)
    expect(distFade(100, 100)).toBe(0)
    expect(distFade(70, 100)).toBeCloseTo(0.5, 9)
  })
})

describe('terrainMacroDetailMath: подчинение данным рельефа', () => {
  it('slopeGain: равнина = 1 − influence, крутой склон = 1, кламп по 1', () => {
    expect(slopeGain(0, 0.6)).toBeCloseTo(0.4, 9)
    expect(slopeGain(1, 0.6)).toBe(1)
    expect(slopeGain(5, 0.6)).toBe(1)
    expect(slopeGain(0, 0)).toBe(1)
  })

  it('cavityGain: яма тише, гребень громче, не уходит ниже 0', () => {
    expect(cavityGain(-1, 0.5)).toBeCloseTo(0.5, 9)
    expect(cavityGain(1, 0.5)).toBeCloseTo(1.5, 9)
    expect(cavityGain(0, 0.5)).toBe(1)
    expect(cavityGain(-1, 2)).toBe(0)
  })
})

describe('terrainMacroDetailMath: наклон нормали полосой', () => {
  it('типичный |grad| fbm (2) при дефолтных ручках даёт 1°–10°, а не микрорадианы', () => {
    const tilt = macroTiltRadians(2, 1, 1)
    expect(tilt).toBeGreaterThan(0.017)
    expect(tilt).toBeLessThan(0.175)
    expect(tilt).toBeCloseTo(Math.atan(2 * MACRO_RELIEF_ASPECT), 12)
  })

  it('нулевой градиент или нулевой контраст — наклона нет; ручка normalScale линейна по тангенсу', () => {
    expect(macroTiltRadians(0, 1, 1)).toBe(0)
    expect(macroTiltRadians(2, 1, 0)).toBe(0)
    expect(Math.tan(macroTiltRadians(2, 2, 1))).toBeCloseTo(2 * Math.tan(macroTiltRadians(2, 1, 1)), 12)
  })
})

describe('terrainMacroDetailMath: направленные формы склона (арка A)', () => {
  it('гейт форм: ноль до s = 0.35, единица при s = 1', () => {
    // абсолютный уклон (tan): холмистость до 0.2 (≈11°) — ноль, стена от 0.45 (≈24°) — единица
    expect(structureGate(0)).toBe(0)
    expect(structureGate(0.2)).toBe(0)
    expect(structureGate(0.45)).toBe(1)
    expect(structureGate(0.325)).toBeCloseTo(0.5, 6)
    expect(structureGate(0.3, 0.1, 0.5)).toBeCloseTo(0.5, 6)
    // покрытие террас: ниже LO нет полок, выше HI — полные
    expect(terraceCoverage(0)).toBe(0)
    expect(terraceCoverage(0.1)).toBe(0)
    expect(terraceCoverage(0.4)).toBe(1)
    expect(terraceCoverage(0.25)).toBeCloseTo(0.5, 6)
  })

  it('профиль террасы: период 1, ноль на концах, площадка спадает с наклоном −1, уступ поднимается', () => {
    expect(terraceProfile(0).value).toBeCloseTo(0, 9)
    expect(terraceProfile(1).value).toBeCloseTo(0, 9)
    expect(terraceProfile(2.25).value).toBeCloseTo(terraceProfile(0.25).value, 9)
    // площадка (t > TERRACE_RISER): value = 1 − t, derivative = −1
    expect(terraceProfile(0.6).value).toBeCloseTo(0.4, 9)
    expect(terraceProfile(0.6).derivative).toBeCloseTo(-1, 9)
    // уступ: производная положительна в середине подъёма
    expect(terraceProfile(TERRACE_RISER / 2).derivative).toBeGreaterThan(0)
  })

  it('фаза отрицательная — эквивалент fract (period 1): значение и производная совпадают со смещённой на период', () => {
    expect(terraceProfile(-0.1).value).toBeCloseTo(terraceProfile(0.9).value, 9)
    expect(terraceProfile(-0.1).derivative).toBeCloseTo(terraceProfile(0.9).derivative, 9)
  })

  it('производная профиля совпадает с конечной разностью', () => {
    for (const phase of [0.05, 0.15, 0.29, 0.5, 0.9]) {
      const h = 1e-5
      const numeric = (terraceProfile(phase + h).value - terraceProfile(phase - h).value) / (2 * h)
      expect(terraceProfile(phase).derivative).toBeCloseTo(numeric, 3)
    }
  })

  it('веса трипланара: сумма 1, ось — единственная плоскость, диагональ — поровну', () => {
    expect(triplanarWeights([1, 0, 0])).toEqual([1, 0, 0])
    const w = triplanarWeights([1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)])
    expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 9)
    expect(w[0]).toBeCloseTo(w[1], 9)
    // 30° от оси: доминанта ≥ 0.95 при показателе 8
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6)
    expect(triplanarWeights([c, s, 0])[0]).toBeGreaterThan(0.95)
  })

  it('градиент струй: компонента вдоль потока делится на STREAK_STRETCH, поперечная — как есть', () => {
    const g = streakGradient2D([1, 0], [0.6, 0.3])
    expect(g[0]).toBeCloseTo(0.6 / STREAK_STRETCH, 9)
    expect(g[1]).toBeCloseTo(0.3, 9)
    const r = streakGradient2D([0, 1], [0.6, 0.3])
    expect(r[0]).toBeCloseTo(-0.3, 9)
    expect(r[1]).toBeCloseTo(0.6 / STREAK_STRETCH, 9)
  })
})
