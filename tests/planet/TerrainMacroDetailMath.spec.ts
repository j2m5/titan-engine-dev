import { describe, expect, it } from 'vitest'
import {
  MACRO_FADE_TEXEL_FACTOR,
  cavityGain,
  distFade,
  macroFadeMetersFor,
  octaveWeight,
  slopeGain
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
