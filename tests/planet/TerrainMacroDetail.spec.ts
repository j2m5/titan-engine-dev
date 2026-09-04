import { describe, expect, it } from 'vitest'
import {
  terrainMacroDetailFunctions,
  terrainMacroDetailUniforms
} from '@/core/materials/shaders/lib/chunks/TerrainMacroDetail'

describe('TerrainMacroDetail: контракт чанка', () => {
  const fn: string = terrainMacroDetailFunctions

  it('объявляет все юниформы полосы', () => {
    for (const name of [
      'uniform float uMacroStrength;',
      'uniform float uMacroNormalScale;',
      'uniform float uMacroPeriodUnits;',
      'uniform float uMacroSlopeInfluence;',
      'uniform float uMacroSlopeRef;',
      'uniform float uMacroCavityInfluence;',
      'uniform float uMacroTextureWarp;',
      'uniform vec2 uMacroFadeRange;',
      'uniform vec2 uDiffuseTexelSize;',
      'uniform float uBodyRadiusUnits;',
      'uniform float uMacroStreakStrength;',
      'uniform float uMacroStreakPeriodUnits;',
      'uniform float uMacroTerraceStrength;',
      'uniform float uMacroTerraceStepMeters;',
      'varying float vHeightMeters;'
    ]) {
      expect(terrainMacroDetailUniforms).toContain(name)
    }
  })

  it('нормаль из аналитического градиента snoiseGrad, без dFdx/dFdy по шуму', () => {
    expect(fn).toContain('snoiseGrad(')
    expect(fn).not.toMatch(/dFd[xy]\(\s*h\b/)
    expect(fn).toContain('g - dirLocal * dot(g, dirLocal)')
    expect(fn).toContain('vec4(n.yzw * frequency, n.x)')
    expect(fn).not.toContain('vec4(n.xyz * frequency, n.w)')
  })

  it('след считается до всех ранних выходов и до варпа; вес октавы и хвост — формулы зеркала', () => {
    const footprint = fn.indexOf('float footprint = length(fwidth(q));')
    const polar = fn.indexOf('if (eastLen < 1e-4) return;')
    const distEarly = fn.indexOf('if (distFade <= 0.0) return;')
    const contrastEarly = fn.indexOf('if (contrast <= 0.0) return;')
    const warp = fn.indexOf('q += uMacroTextureWarp')
    expect(footprint).toBeGreaterThan(-1)
    // fwidth однороден по кваду: полярный гард и оба выхода — строго ПОСЛЕ следа
    expect(footprint).toBeLessThan(polar)
    expect(polar).toBeLessThan(distEarly)
    expect(distEarly).toBeLessThan(contrastEarly)
    expect(contrastEarly).toBeLessThan(warp)
    expect(fn).toContain('1.0 - smoothstep(0.5, 1.0, footprint * frequency)')
    expect(fn).toContain('smoothstep(0.0, 0.25, norm)')
  })

  it('ранний выход по дистанции стоит до единственных выборок текстуры (диффуз варпа)', () => {
    const distEarly = fn.indexOf('if (distFade <= 0.0) return;')
    const firstFetch = fn.indexOf('texture2D(')
    expect(firstFetch).toBeGreaterThan(distEarly)
    // slope/cavity приходят параметрами — чанк slope-карту не сэмплит
    expect(fn).not.toContain('texture2D(bumpMap')
    expect(fn).not.toContain('slopeSample')
  })

  it('подчинение данным: гейт уклона по uMacroSlopeRef, варп по dLum вдоль north', () => {
    expect(fn).toContain('float s = clamp(length(slope) / uMacroSlopeRef, 0.0, 1.0);')
    expect(fn).toContain('1.0 + uMacroCavityInfluence * cavity')
    expect(fn).toContain('vec3 north = cross(dirLocal, eastLocal);')
    expect(fn).toContain('q += uMacroTextureWarp * dLum * north;')
    expect(fn).toContain('uv + vec2(0.0, uDiffuseTexelSize.y)')
    expect(fn).toContain('uv - vec2(0.0, uDiffuseTexelSize.y)')
    expect(fn).not.toContain('4096')
  })

  it('сигнатура принимает slope и cavity от хоста', () => {
    expect(fn).toContain(
      'void applyTerrainMacroDetail(inout vec3 nLocal, inout vec3 albedoMul, vec3 dirLocal, vec3 eastLocal, vec2 slope, float cavity, vec2 uv, float viewDistance)'
    )
  })

  it('наклон нормали — отношение амплитуды к периоду, без множителя P/R', () => {
    expect(fn).toContain('#define MACRO_RELIEF_ASPECT 0.03')
    expect(fn).toContain('MACRO_RELIEF_ASPECT * contrast * gradTangent')
    expect(fn).not.toContain('uMacroPeriodUnits / max(uBodyRadiusUnits')
  })

  it('полярный гард по длине eastLocal и кламп альбедо [0, 2]; алиаса fade нет (тень vec3 fade из noiseFunctions)', () => {
    expect(fn).toContain('if (eastLen < 1e-4) return;')
    expect(fn).toContain('clamp(1.0 + uMacroStrength * contrast * h, 0.0, 2.0)')
    expect(fn).not.toContain('float fade = contrast;')
  })
})
