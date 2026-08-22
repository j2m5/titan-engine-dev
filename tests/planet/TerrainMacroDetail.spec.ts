import { describe, expect, it } from 'vitest'
import {
  terrainMacroDetailFunctions,
  terrainMacroDetailUniforms
} from '@/core/materials/shaders/lib/chunks/TerrainMacroDetail'
import { SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'

describe('TerrainMacroDetail: контракт чанка', () => {
  const fn: string = terrainMacroDetailFunctions

  it('объявляет все юниформы полосы', () => {
    for (const name of [
      'uniform float uMacroStrength;',
      'uniform float uMacroNormalScale;',
      'uniform float uMacroPeriodUnits;',
      'uniform float uMacroSlopeInfluence;',
      'uniform float uMacroCavityInfluence;',
      'uniform float uMacroTextureWarp;',
      'uniform vec2 uMacroFadeRange;',
      'uniform vec2 uDiffuseTexelSize;',
      'uniform float uBodyRadiusUnits;'
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

  it('след считается до варпа и до раннего выхода; вес октавы и хвост — формулы зеркала', () => {
    const footprint = fn.indexOf('float footprint = length(fwidth(q));')
    const warp = fn.indexOf('q += uMacroTextureWarp')
    const early = fn.indexOf('if (contrast <= 0.0) return;')
    expect(footprint).toBeGreaterThan(-1)
    expect(footprint).toBeLessThan(warp)
    expect(footprint).toBeLessThan(early)
    expect(fn).toContain('1.0 - smoothstep(0.5, 1.0, footprint * frequency)')
    expect(fn).toContain('smoothstep(0.0, 0.25, norm)')
  })

  it('подчинение данным: slope через SLOPE_RANGE, cavity из канала B, варп по dLum вдоль north', () => {
    expect(fn).toContain(`(${SLOPE_RANGE.toFixed(1)} / 127.0)`)
    expect(fn).toContain('(slopeSample.z * 255.0 - 128.0) / 127.0')
    expect(fn).toContain('vec3 north = cross(dirLocal, eastLocal);')
    expect(fn).toContain('q += uMacroTextureWarp * dLum * north;')
    expect(fn).toContain('uv + vec2(0.0, uDiffuseTexelSize.y)')
    expect(fn).toContain('uv - vec2(0.0, uDiffuseTexelSize.y)')
    expect(fn).not.toContain('4096')
  })

  it('полярный гард по длине eastLocal и кламп альбедо [0, 2]', () => {
    expect(fn).toContain('if (eastLen < 1e-4) return;')
    expect(fn).toContain('clamp(1.0 + uMacroStrength * fade * h, 0.0, 2.0)')
  })
})
