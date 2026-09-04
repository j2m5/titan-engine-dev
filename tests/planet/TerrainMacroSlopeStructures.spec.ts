import { describe, expect, it } from 'vitest'
import {
  terrainMacroDetailFunctions,
  terrainMacroDetailUniforms
} from '@/core/materials/shaders/lib/chunks/TerrainMacroDetail'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import {
  MACRO_RELIEF_ASPECT_STREAK,
  STREAK_PLANE_MIN_WEIGHT,
  STREAK_PLANE_POW,
  STREAK_STRETCH,
  TERRACE_RISER,
  TERRACE_SHADE,
  TERRACE_WOBBLE
} from '@/core/materials/shaders/lib/chunks/terrainMacroDetailMath'

const fn: string = terrainMacroDetailFunctions

describe('TerrainMacroDetail: направленные формы склона (арка A)', () => {
  it('константы чанка равны зеркалу', () => {
    expect(fn).toContain(`#define STREAK_STRETCH ${STREAK_STRETCH.toFixed(1)}`)
    expect(fn).toContain(`#define MACRO_RELIEF_ASPECT_STREAK ${MACRO_RELIEF_ASPECT_STREAK}`)
    expect(fn).toContain(`#define STREAK_PLANE_POW ${STREAK_PLANE_POW.toFixed(1)}`)
    expect(fn).toContain(`#define STREAK_PLANE_MIN_WEIGHT ${STREAK_PLANE_MIN_WEIGHT}`)
    expect(fn).toContain(`#define TERRACE_WOBBLE ${TERRACE_WOBBLE}`)
    expect(fn).toContain(`#define TERRACE_RISER ${TERRACE_RISER}`)
    expect(fn).toContain(`#define TERRACE_SHADE ${TERRACE_SHADE}`)
  })

  it('юниформы форм и varying высоты объявлены в блоке чанка', () => {
    for (const line of [
      'uniform float uMacroStreakStrength;',
      'uniform float uMacroStreakPeriodUnits;',
      'uniform float uMacroTerraceStrength;',
      'uniform float uMacroTerraceStepMeters;',
      'varying float vHeightMeters;'
    ]) {
      expect(terrainMacroDetailUniforms).toContain(line)
    }
  })

  it('базис склона: d — против вектора уклона (вниз), в базисе T/B SlopeNormal', () => {
    expect(fn).toContain('vec3 slopeVec = slope.x * T + slope.y * B;')
    expect(fn).toContain('vec3 d = -slopeVec / slopeLen;')
    expect(fn).toContain('vec3 B = cross(dirLocal, T);')
  })

  it('след струй считается до ранних выходов, формы — после применения изотропного результата', () => {
    const streakFootprint = fn.indexOf('float streakWeight = 1.0 - smoothstep(0.5, 1.0, length(fwidth(qs)));')
    const polar = fn.indexOf('if (eastLen < 1e-4) return;')
    const isoAlbedo = fn.indexOf('albedoMul *= clamp(1.0 + uMacroStrength * contrast * h, 0.0, 2.0);')
    const call = fn.indexOf('applyMacroSlopeStructures(')
    const callSite = fn.lastIndexOf('applyMacroSlopeStructures(')
    expect(streakFootprint).toBeGreaterThan(-1)
    expect(streakFootprint).toBeLessThan(polar)
    expect(callSite).toBeGreaterThan(isoAlbedo)
    expect(call).toBeLessThan(callSite) // определение раньше вызова
  })

  it('гейт форм и ранний выход по нему', () => {
    expect(fn).toContain('float gate = smoothstep(0.35, 1.0, s);')
    expect(fn).toContain('if (gate <= 0.0) return;')
  })

  it('струи: трипланар с весом |dir|^POW, порог веса, цепное правило с делением на STREAK_STRETCH', () => {
    expect(fn).toContain('vec3 w3 = pow(abs(dirLocal), vec3(STREAK_PLANE_POW));')
    expect((fn.match(/>= STREAK_PLANE_MIN_WEIGHT/g) ?? []).length).toBe(3)
    expect(fn).toContain('(n.y / STREAK_STRETCH) * d2 + n.z * p2')
    expect(fn).toContain('dot(uv, d2) / STREAK_STRETCH')
  })

  it('террасы: фаза от vHeightMeters (не от позиции), наклон модулирует slopeVec производной профиля', () => {
    const terr = fn.slice(fn.indexOf('vec2 tp = terraceProfile('), fn.indexOf('TERRACE_SHADE * k'))
    expect(terr).toContain('vHeightMeters / max(uMacroTerraceStepMeters, 1e-3) + TERRACE_WOBBLE * fbmValue')
    expect(terr).toContain('tp.y * slopeVec')
    expect(terr).not.toContain('vPosition')
  })

  it('в функциях форм нет экранных производных по шуму', () => {
    const structures = fn.slice(fn.indexOf('void applyMacroSlopeStructures('), fn.indexOf('vec4 macroFbm('))
    expect(structures).not.toMatch(/dFd[xy]\(/)
    expect(structures).not.toContain('fwidth(')
  })

  it('вершинник: атрибут height и varying под USE_TERRAIN_MACRO_DETAIL', () => {
    const vert: string = PlanetShaderTemplate.vertexShader
    const gate = vert.indexOf('#ifdef USE_TERRAIN_MACRO_DETAIL')
    expect(gate).toBeGreaterThan(-1)
    expect(vert.indexOf('attribute float height;')).toBeGreaterThan(gate)
    expect(vert).toContain('vHeightMeters = height;')
  })
})
