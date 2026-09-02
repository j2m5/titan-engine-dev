import { describe, expect, it } from 'vitest'
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
    expect(resolveSteepZoneParams({}, 'Moon')).toEqual({ steepStart: 0.35, steepFull: 0.55, steepBreakup: 0.15 })
  })

  it('пер-тельные значения проходят как есть', () => {
    expect(resolveSteepZoneParams({ steepStart: 0.5, steepFull: 0.9, steepBreakup: 0 }, 'Io'))
      .toEqual({ steepStart: 0.5, steepFull: 0.9, steepBreakup: 0 })
  })

  it('невалидные — громкая ошибка с телом и полем', () => {
    expect(() => resolveSteepZoneParams({ steepStart: 0.6, steepFull: 0.5 }, 'Io')).toThrow(/Io.*steepFull/)
    expect(() => resolveSteepZoneParams({ steepStart: 0 }, 'X')).toThrow(/steepStart/)
    expect(() => resolveSteepZoneParams({ steepBreakup: -1 }, 'X')).toThrow(/steepBreakup/)
    expect(() => resolveSteepZoneParams({ steepStart: 'a' }, 'X')).toThrow(/steepStart/)
  })
})
