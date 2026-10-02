import { describe, expect, it } from 'vitest'
import { waterGlintFunctions } from '@/core/materials/shaders/lib/chunks/WaterGlint'
import { waterOctavesFunctions } from '@/core/materials/shaders/lib/chunks/WaterOctaves'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import {
  WATER_FAR_ALPHA2,
  WATER_RIPPLE_PERIODS_METERS,
  WATER_WAVE_PERIODS_METERS,
  farGlintAlpha2,
  glintAlpha2,
  waterGlint
} from '@/core/materials/shaders/lib/chunks/waterOctavesMath'
import { WATER_SURFACE_DEFAULTS, resolveWaterSurfaceParams } from '@/core/terrain/waterSurfaceParams'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'

describe('farGlintAlpha2 — шероховатость блика, когда все октавы погасли (орбита)', () => {
  it('равна glintAlpha2 при нулевых весах всех октав', () => {
    const zeros = (n: number): number[] => Array.from({ length: n }, () => 0)
    expect(farGlintAlpha2(0.05, 0.7)).toBe(
      glintAlpha2(0.05, zeros(WATER_RIPPLE_PERIODS_METERS.length), zeros(WATER_WAVE_PERIODS_METERS.length), 0.7)
    )
  })

  it('WATER_FAR_ALPHA2 — при глобальных дефолтах воды, ≈ 0.0727', () => {
    expect(WATER_FAR_ALPHA2).toBe(farGlintAlpha2(WATER_SURFACE_DEFAULTS.waterRoughness, WATER_SURFACE_DEFAULTS.waterRippleStrength))
    expect(WATER_FAR_ALPHA2).toBeCloseTo(0.0727, 3)
  })

  it('пин калибровки: пик блика в надир при дальней шероховатости ≈ 0.0267 (gain 1)', () => {
    expect(waterGlint(1, 1, 1, WATER_FAR_ALPHA2)).toBeCloseTo(0.0267, 3)
  })

  it('растёт с шероховатостью и силой ряби', () => {
    expect(farGlintAlpha2(0.1, 1)).toBeGreaterThan(farGlintAlpha2(0.02, 1))
    expect(farGlintAlpha2(0.02, 2)).toBeGreaterThan(farGlintAlpha2(0.02, 1))
  })
})

describe('waterGlintFunctions — отдельный чанк', () => {
  it('зарегистрирован в AppShaderChunk (иначе #include молча станет пустой строкой)', () => {
    expect(AppShaderChunk.waterGlintFunctions).toBe(waterGlintFunctions)
  })

  it('несёт функцию и дефайны блика; чанк октав больше их не дублирует', () => {
    expect(waterGlintFunctions).toContain('float waterGlintGlsl(vec3 n, vec3 l, vec3 v, float alpha2) {')
    for (const d of ['WATER_GLINT_F0', 'WATER_GLINT_CEILING', 'WATER_MIN_ALPHA2', 'WATER_MAX_ALPHA2', 'WATER_PI']) {
      expect(waterGlintFunctions).toContain(`#define ${d} `)
      expect(waterOctavesFunctions).not.toContain(`#define ${d} `)
    }
    expect(waterOctavesFunctions).not.toContain('float waterGlintGlsl(')
  })

  it('вода включает чанк на верхнем уровне, вне USE_WATER_WAVES', () => {
    const frag = WaterShaderTemplate.fragmentShader
    const inc = frag.indexOf('#include <waterGlintFunctions>')
    expect(inc).toBeGreaterThan(-1)
    const before = frag.slice(0, inc)
    expect((before.match(/#endif/g) ?? []).length).toBe((before.match(/#if/g) ?? []).length)
    expect(inc).toBeLessThan(frag.indexOf('#include <waterOctavesFunctions>'))
  })
})

describe('waterSurfaceParams.waterGlintGain', () => {
  it('дефолт 1, значение из данных, отказ на отрицательном и не-числе', () => {
    expect(WATER_SURFACE_DEFAULTS.waterGlintGain).toBe(1)
    expect(resolveWaterSurfaceParams(undefined, 'T').waterGlintGain).toBe(1)
    expect(resolveWaterSurfaceParams({ waterGlintGain: Math.PI }, 'T').waterGlintGain).toBe(Math.PI)
    expect(() => resolveWaterSurfaceParams({ waterGlintGain: -1 }, 'T')).toThrow(/waterGlintGain/)
    expect(() => resolveWaterSurfaceParams({ waterGlintGain: 'x' }, 'T')).toThrow(/waterGlintGain/)
  })
})
