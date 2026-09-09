import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'
import { resolveSteepZoneParams } from '@/core/terrain/steepZoneParams'

describe('STEEP_DETAIL_PATHS', () => {
  it('универсальный «крутой» набор — ровно rocky_trail-тройка', () => {
    expect(STEEP_DETAIL_PATHS).toEqual({
      diffuse: 'terrain/rocky_trail_diff.webp',
      normal: 'terrain/rocky_trail_nor.webp',
      arm: 'terrain/rocky_trail_arm.webp'
    })
  })
})

describe('resolveSteepZoneParams', () => {
  it('пустые данные — глобальные дефолты 0.35/0.55/0.15', () => {
    expect(resolveSteepZoneParams({}, 'Moon')).toEqual({
      steepStart: 0.35,
      steepFull: 0.55,
      steepBreakup: 0.15,
      steepTint: new Color(0xe7e7e7)
    })
  })

  it('пер-тельные значения проходят как есть', () => {
    expect(resolveSteepZoneParams({ steepStart: 0.5, steepFull: 0.9, steepBreakup: 0 }, 'Io')).toEqual({
      steepStart: 0.5,
      steepFull: 0.9,
      steepBreakup: 0,
      steepTint: new Color(0xe7e7e7)
    })
  })

  it('невалидные — громкая ошибка с телом и полем', () => {
    expect(() => resolveSteepZoneParams({ steepStart: 0.6, steepFull: 0.5 }, 'Io')).toThrow(/Io.*steepFull/)
    expect(() => resolveSteepZoneParams({ steepStart: 0 }, 'X')).toThrow(/steepStart/)
    expect(() => resolveSteepZoneParams({ steepBreakup: -1 }, 'X')).toThrow(/steepBreakup/)
    expect(() => resolveSteepZoneParams({ steepStart: 'a' }, 'X')).toThrow(/steepStart/)
  })

  it('steepTint: дефолт 0xe7e7e7 → линейный ≈ 0.80; число и строка через Color; мусор — ошибка', () => {
    const def = resolveSteepZoneParams({}, 'x').steepTint
    expect(def).toBeInstanceOf(Color)
    expect(def.r).toBeCloseTo(0.8, 2)
    expect(resolveSteepZoneParams({ steepTint: 0xffffff }, 'x').steepTint.g).toBe(1)
    expect(resolveSteepZoneParams({ steepTint: '#000000' }, 'x').steepTint.b).toBe(0)
    expect(() => resolveSteepZoneParams({ steepTint: true }, 'Марс')).toThrow(/steepZone Марс: steepTint/)
  })
})
