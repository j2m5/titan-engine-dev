import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { slopeNormalFunctions, slopeNormalUniforms } from '@/core/materials/shaders/lib/chunks/SlopeNormal'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('SlopeNormal: попиксельная нормаль из slope-карты', () => {
  it('чанк зарегистрирован — иначе include молча раскроется в пустоту', () => {
    expect(AppShaderChunk.slopeNormalFunctions).toBe(slopeNormalFunctions)
    expect(AppShaderChunk.slopeNormalUniforms).toBe(slopeNormalUniforms)
  })

  it('одна выборка RG вместо четырёх выборок высот — мипы фильтруют уклоны сами', () => {
    expect(slopeNormalFunctions).toContain('texture2D(bumpMap, uv).xy')
    expect(slopeNormalFunctions).not.toContain('uBumpTexelSize')
  })

  it('декод через юниформ uSlopeRange — диапазон per-map, не константа', () => {
    expect(slopeNormalUniforms).toContain('uniform float uSlopeRange;')
    expect(slopeNormalFunctions).toContain('* 255.0 - 128.0')
    expect(slopeNormalFunctions).toContain('(uSlopeRange / 127.0)')
    expect(slopeNormalFunctions).not.toContain('(2.0 / 127.0)')
  })

  it('у полюса тангенс вырожден — возвращается геометрическая нормаль, слой не декодирован (slopeOut = 0)', () => {
    expect(slopeNormalFunctions).toContain('if (len < 1e-4) {')
    expect(slopeNormalFunctions).toContain('slopeOut = vec2(0.0);')
    expect(slopeNormalFunctions).toContain('return surfNormal; // полюс: тангенс вырожден')
  })

  it('ровно одна форма функции — с extraSlope и out slopeOut; обёртки без вызывающих сняты', () => {
    const declarations = (slopeNormalFunctions.match(/vec3 perturbNormalFromSlope\(/g) ?? []).length
    expect(declarations).toBe(1)
    expect(slopeNormalFunctions).toContain(
      'vec3 perturbNormalFromSlope(vec3 surfNormal, vec3 east, vec2 uv, vec2 extraSlope, out vec2 slopeOut)'
    )
    expect(slopeNormalFunctions).toContain('slopeOut = slope;')
    // ровно одна текстурная выборка на весь чанк
    const sampleCalls = (slopeNormalFunctions.match(/texture2D\(bumpMap, uv\)/g) ?? []).length
    expect(sampleCalls).toBe(1)
  })

  it('шаблон зовёт perturbNormalFromSlope локальными аргументами под USE_SLOPE, out-вариантом (без второй выборки bumpMap)', () => {
    expect(PlanetShaderTemplate.fragmentShader).toContain('#ifdef USE_SLOPE')
    // терраформная ветка (USE_SLOPE) зовёт локальными аргументами — один
    // normalMatrix применяется в конце ветки (см. FragmentUv.spec); легаси
    // ветка USE_BUMP вымерла вместе с типом ресурса bump. out-параметр
    // terrainSlopeVec — маска зон материала TerrainDetail (задача 2, фикс-раунд 1):
    // тот же декод, что внутри чанка, без повторной выборки текстуры.
    expect(PlanetShaderTemplate.fragmentShader).toContain(
      'perturbNormalFromSlope(nLocal, eastLocal, uv, vMidTilt, terrainSlopeVec)'
    )
    expect(PlanetShaderTemplate.fragmentShader).not.toContain('USE_BUMP')
  })
})
