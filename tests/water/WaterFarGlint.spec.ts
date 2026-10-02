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
import { WaterShader } from '@/core/materials/shaders/WaterShader'
import type { Actor } from '@/core/models/Actor'
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

  it('крупные веса × waveFade = 0 → α² равна дальней, пик блика ≈ 0.0267', () => {
    const waveFade = 0
    const big = [0, 1, 1, 1].map(w => w * waveFade)
    const alpha2 = glintAlpha2(0.02, WATER_RIPPLE_PERIODS_METERS.map(() => 0), big, 1)
    expect(alpha2).toBe(WATER_FAR_ALPHA2)
    expect(waterGlint(1, 1, 1, alpha2)).toBeCloseTo(0.0267, 3)
  })

  it('при waveFade = 1 произведение весов совпадает с исходными (вблизи без изменений)', () => {
    const raw = [0.3, 1, 1, 1]
    const zeros = WATER_RIPPLE_PERIODS_METERS.map(() => 0)
    expect(glintAlpha2(0.02, zeros, raw.map(w => w * 1), 1)).toBe(glintAlpha2(0.02, zeros, raw, 1))
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

describe('WaterShaderTemplate: блик живёт и с орбиты', () => {
  const frag = WaterShaderTemplate.fragmentShader
  const main = frag.slice(frag.indexOf('void main()'))

  it('блик не умножается на waveFade и прибавляется вне USE_WATER_WAVES', () => {
    expect(main).not.toMatch(/glint[^;]*\* waveFade/)
    const add = frag.indexOf('color += min(glint, WATER_GLINT_CEILING) * uWaterGlintGain * (1.0 - foam);')
    expect(add).toBeGreaterThan(-1)
    const before = frag.slice(frag.indexOf('void main()'), add).replace(/\/\/.*$/gm, '') // без комментариев: в них упоминается #ifdef
    expect((before.match(/#endif/g) ?? []).length).toBe((before.match(/#if/g) ?? []).length)
  })

  it('без волн — аналитическая нормаль и дальняя шероховатость; волны их перезаписывают', () => {
    expect(main).toContain('vec3 glintNormal = normal;')
    expect(main).toContain('float glintAlpha2 = uWaterFarAlpha2;')
    expect(main).toContain('float glintDayFactor = dayFactor;')
    expect(main).toContain('glintNormal = waveNormal;')
    expect(main).toContain('glintAlpha2 = alpha2;')
    expect(main).toContain('glintDayFactor = waveDayFactor;')
    expect(main).toContain('vec3 glint = waterGlintGlsl(glintNormal, lightDirection, viewDir, glintAlpha2) * waterSunColor * dayFactor;')
  })

  it('крупная дисперсия считает октавы, выведенные из нормали по waveFade', () => {
    expect(main).toContain('dot(1.0 - waveWeights * waveFade, vec4(WATER_OCTAVE_SLOPE_VARIANCE / 16.0))')
    expect(main).not.toContain('dot(1.0 - waveWeights, vec4(')
  })

  it('пена объявлена один раз, до блока волн', () => {
    expect(main.match(/float foam\b/g)).toHaveLength(1)
    expect(main.indexOf('float foam = 0.0;')).toBeLessThan(main.indexOf('#ifdef USE_WATER_WAVES'))
  })

  it('дефолты юниформов шаблона', () => {
    expect(WaterShaderTemplate.uniforms.uWaterFarAlpha2.value).toBe(WATER_FAR_ALPHA2)
    expect(WaterShaderTemplate.uniforms.uWaterGlintGain.value).toBe(1)
  })
})

describe('WaterShader: uWaterFarAlpha2 и uWaterGlintGain из данных тела', () => {
  // Тот же стаб, что stubActor в tests/water/WaterMaterial.spec.ts: только то, что читает WaterShader
  function stubWaterActor(data: Record<string, unknown>): Actor {
    return {
      renderingObject: { getAttribute: () => data },
      children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
      resources: { where: () => ({ first: () => undefined }) }
    } as unknown as Actor
  }

  it('дефолты при пустых данных', () => {
    const shader = new WaterShader(stubWaterActor({ waterLevelMeters: 0 }))
    expect(shader.uniforms.uWaterFarAlpha2.value).toBe(WATER_FAR_ALPHA2)
    expect(shader.uniforms.uWaterGlintGain.value).toBe(1)
  })

  it('заданные шероховатость, рябь и gain', () => {
    const shader = new WaterShader(stubWaterActor({ waterLevelMeters: 0, waterRoughness: 0.1, waterRippleStrength: 0.5, waterGlintGain: 3 }))
    expect(shader.uniforms.uWaterFarAlpha2.value).toBe(farGlintAlpha2(0.1, 0.5))
    expect(shader.uniforms.uWaterGlintGain.value).toBe(3)
  })
})
