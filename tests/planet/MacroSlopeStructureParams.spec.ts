import { describe, expect, it } from 'vitest'
import { resolveMacroSlopeStructureParams } from '@/core/terrain/macroSlopeStructureParams'

describe('resolveMacroSlopeStructureParams: ручки форм склона', () => {
  it('дефолты при отсутствии ручек и при отсутствии data', () => {
    expect(resolveMacroSlopeStructureParams({}, 'Луна')).toEqual({
      macroStreakStrength: 0.6,
      macroStreakScaleKm: 0.8,
      macroTerraceStrength: 0.5,
      macroTerraceStepMeters: 150,
      macroStructureSlopeStart: 0.2,
      macroStructureSlopeFull: 0.45
    })
    expect(resolveMacroSlopeStructureParams(undefined, 'Луна').macroStreakStrength).toBe(0.6)
  })

  it('заданные значения доезжают', () => {
    const p = resolveMacroSlopeStructureParams({ macroStreakStrength: 0, macroTerraceStepMeters: 300 }, 'Марс')
    expect(p.macroStreakStrength).toBe(0)
    expect(p.macroTerraceStepMeters).toBe(300)
    expect(p.macroStreakScaleKm).toBe(0.8)
  })

  it('валидация громкая, с именем тела', () => {
    expect(() => resolveMacroSlopeStructureParams({ macroStreakStrength: -1 }, 'Титания')).toThrow(/Титания/)
    expect(() => resolveMacroSlopeStructureParams({ macroStreakScaleKm: 0 }, 'Титания')).toThrow(/macroStreakScaleKm/)
    expect(() => resolveMacroSlopeStructureParams({ macroStructureSlopeStart: -0.1 }, 'Титания')).toThrow(/macroStructureSlopeStart/)
    expect(() => resolveMacroSlopeStructureParams({ macroStructureSlopeStart: 0.5 }, 'Титания')).toThrow(/macroStructureSlopeFull/)
    expect(() => resolveMacroSlopeStructureParams({ macroTerraceStepMeters: -5 }, 'Титания')).toThrow(/macroTerraceStepMeters/)
    expect(() => resolveMacroSlopeStructureParams({ macroTerraceStrength: 'x' }, 'Титания')).toThrow(/не число/)
    expect(() => resolveMacroSlopeStructureParams({ macroTerraceStrength: -1 }, 'Титания')).toThrow(/macroTerraceStrength/)
  })
})
