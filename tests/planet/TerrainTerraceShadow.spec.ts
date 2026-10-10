import { describe, expect, it } from 'vitest'
import {
  TERRACE_EDGE_PHASE,
  TERRACE_EDGE_PROFILE,
  TERRACE_SHADOW_K_FADE,
  terraceCastShadow,
  terraceProfile
} from '@/core/materials/shaders/lib/chunks/terrainMacroDetailMath'
import { terrainMacroDetailFunctions } from '@/core/materials/shaders/lib/chunks/TerrainMacroDetail'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'

/** Солнце в плоскости линии падения: up — вертикаль, uphill — к верху склона */
function sun(elevationTan: number): { up: number; uphill: number } {
  const a = 1 / Math.hypot(1, elevationTan)
  return { up: elevationTan * a, uphill: a }
}

describe('кромка уступа — максимум профиля террасы', () => {
  it('TERRACE_EDGE_PHASE/PROFILE совпадают с максимумом terraceProfile', () => {
    let best = -Infinity
    let at = 0
    for (let i = 0; i <= 100000; i++) {
      const value = terraceProfile(i / 100000).value
      if (value > best) {
        best = value
        at = i / 100000
      }
    }
    expect(TERRACE_EDGE_PHASE).toBeCloseTo(at, 4)
    expect(TERRACE_EDGE_PROFILE).toBeCloseTo(best, 6)
  })
})

describe('terraceCastShadow: тень уступа на площадке ниже', () => {
  const k = 0.5
  const slope = 0.4

  it('низкое солнце со стороны верха склона: площадка у подножия следующего уступа в тени', () => {
    const s = sun(0.45)
    expect(terraceCastShadow(0.95, k, s.up, s.uphill, slope, 0)).toBe(0)
  })

  it('высокое солнце: та же точка освещена', () => {
    const s = sun(2)
    expect(terraceCastShadow(0.95, k, s.up, s.uphill, slope, 0)).toBe(1)
  })

  it('солнце со стороны низа склона или под горизонтом — теней уступов нет', () => {
    expect(terraceCastShadow(0.95, k, 0.2, -0.98, slope, 0)).toBe(1)
    expect(terraceCastShadow(0.95, k, -0.1, 0.99, slope, 0)).toBe(1)
  })

  it('нет ступени (k = 0) — нет тени, даже если склон круче солнца', () => {
    const s = sun(0.1)
    expect(terraceCastShadow(0.95, 0, s.up, s.uphill, slope, 0)).toBe(1)
  })

  it('чем ниже солнце, тем шире тень: доля затенённого периода не убывает', () => {
    const fraction = (tanE: number): number => {
      const s = sun(tanE)
      const n = 1000
      let shadowed = 0
      for (let i = 0; i < n; i++) shadowed += 1 - terraceCastShadow(i / n, k, s.up, s.uphill, slope, 0)
      return shadowed / n
    }
    const series = [3, 1.5, 1, 0.7, 0.5, 0.42].map(fraction)
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThanOrEqual(series[i - 1])
    expect(series[0]).toBe(0)
    expect(series[series.length - 1]).toBeGreaterThan(0.3)
  })

  it('уступ круче солнца затеняет сам себя; при высоком солнце — нет', () => {
    const low = sun(0.42)
    const high = sun(3)
    expect(terraceCastShadow(0.25, 1, low.up, low.uphill, slope, 0)).toBe(0)
    expect(terraceCastShadow(0.25, 1, high.up, high.uphill, slope, 0)).toBe(1)
  })

  it('край тени сглажен по следу пикселя', () => {
    // точка 0.95 на границе тени: k·(кромка − профиль) = g·u
    const u = TERRACE_EDGE_PHASE + 1 - 0.95
    const g = (k * (TERRACE_EDGE_PROFILE - terraceProfile(0.95).value)) / u
    const s = sun(slope * (1 + g))
    const value = terraceCastShadow(0.95, k, s.up, s.uphill, slope, 0.05)
    expect(value).toBeGreaterThan(0.4)
    expect(value).toBeLessThan(0.6)
  })

  it('слабая ступень (k < TERRACE_SHADOW_K_FADE) ослабляет тень плавно', () => {
    const s = sun(slope)
    expect(terraceCastShadow(0.95, k, s.up, s.uphill, slope, 0)).toBe(0)
    const faint = terraceCastShadow(0.95, TERRACE_SHADOW_K_FADE * 0.5, s.up, s.uphill, slope, 0)
    expect(faint).toBeGreaterThan(0)
    expect(faint).toBeLessThan(1)
  })
})

describe('проводка тени уступов', () => {
  const fn = terrainMacroDetailFunctions
  const frag = TerrainShaderTemplate.fragmentShader

  it('чанк: тень из профиля, k и солнца в плоскости линии падения; след фазы — до ранних выходов', () => {
    expect(fn).toContain('float terraceCastShadow(float phase, float profile, float k, float sunUp, float sunUphill, float slopeTan, float phaseFootprint)')
    expect(fn).toContain(
      'terraceShadow = terraceCastShadow(terracePhase, tp.x, k, dot(sunLocal, dirLocal), -dot(sunLocal, d), slopeLen, terracePhaseFootprint);'
    )
    const footprint = fn.indexOf('float terracePhaseFootprint = fwidth(vHeightMeters) / max(uMacroTerraceStepMeters, 1e-3);')
    expect(footprint).toBeGreaterThan(-1)
    expect(footprint).toBeLessThan(fn.indexOf('if (eastLen < 1e-4) return;'))
  })

  it('внутри функций форм склона и тени нет экранных производных', () => {
    const body = fn.slice(fn.indexOf('vec2 terraceProfile('), fn.indexOf('vec4 macroFbm('))
    expect(body).not.toMatch(/\bfwidth\b|\bdFdx\b|\bdFdy\b/)
  })

  it('хост: sunLocal и terraceShadow до вызова полосы; тень уступов гасит только прямой свет', () => {
    const call = frag.indexOf(
      'applyTerrainMacroDetail(nLocal, albedoMul, occlusion, terraceShadow, dirLocal, eastLocal, sunLocal, macroSlope, length(macroMapSlope), macroCavity, uv, length(vViewPosition));'
    )
    expect(call).toBeGreaterThan(-1)
    expect(frag.indexOf('vec3 sunLocal = -normalize(vLocalLightDirection);')).toBeLessThan(call)
    expect(frag.indexOf('float terraceShadow = 1.0;')).toBeLessThan(call)
    const gain = frag.indexOf('float directGain = ')
    const mul = frag.indexOf('directGain *= terraceShadow;')
    expect(mul).toBeGreaterThan(gain)
    expect(frag).not.toMatch(/ambient[^;]*terraceShadow/)
  })
})
