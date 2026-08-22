import { describe, expect, it } from 'vitest'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('PlanetShaderTemplate: средняя полоса детали в терраформной ветке', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader

  it('чанки под гейтом USE_TERRAIN_MACRO_DETAIL, после noiseFunctions и объявлений diffuseMap/bumpMap', () => {
    const gate = frag.indexOf('#ifdef USE_TERRAIN_MACRO_DETAIL')
    const uniforms = frag.indexOf('#include <terrainMacroDetailUniforms>')
    const functions = frag.indexOf('#include <terrainMacroDetailFunctions>')
    expect(gate).toBeGreaterThan(-1)
    expect(uniforms).toBeGreaterThan(gate)
    expect(functions).toBeGreaterThan(uniforms)
    // noiseFunctions внутри того же гейта, перед функциями полосы
    const noiseInGate = frag.indexOf('#include <noiseFunctions>', gate)
    expect(noiseInGate).toBeGreaterThan(gate)
    expect(noiseInGate).toBeLessThan(functions)
    expect(frag.indexOf('uniform sampler2D diffuseMap;')).toBeLessThan(functions)
    expect(frag.indexOf('uniform sampler2D bumpMap;')).toBeLessThan(functions)
  })

  it('вызов стоит после USE_CAVITY и до applyTerrainDetail, в терраформной ветке', () => {
    const cavity = frag.indexOf('#ifdef USE_CAVITY')
    const call = frag.indexOf(
      'applyTerrainMacroDetail(nLocal, albedoMul, dirLocal, eastLocal, uv, length(vViewPosition));'
    )
    const detail = frag.indexOf('applyTerrainDetail(nLocal, albedoMul, dirLocal, length(vViewPosition));')
    const normalOut = frag.indexOf('normal = normalize(normalMatrix * nLocal);')
    expect(call).toBeGreaterThan(cavity)
    expect(call).toBeLessThan(detail)
    expect(detail).toBeLessThan(normalOut)
  })

  it('noiseFunctions подключается не более двух раз (гиганты и полоса — разные гейты)', () => {
    expect((frag.match(/#include <noiseFunctions>/g) ?? []).length).toBeLessThanOrEqual(2)
  })
})
