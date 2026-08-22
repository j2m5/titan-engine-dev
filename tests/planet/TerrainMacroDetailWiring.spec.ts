import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture, Vector2 } from 'three'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { macroFadeMetersFor } from '@/core/materials/shaders/lib/chunks/terrainMacroDetailMath'

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

const DIFFUSE_PATH = 'stub/macro/diffuse.png'

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg']) seedTexture(name)
}

/** Стаб тела: радиус в physicalObject, ручки в renderingObject.data, диффуз по пути. */
function stubActor(radiusKm: number, data: Record<string, unknown>, diffusePath: string = DIFFUSE_PATH): Actor {
  return {
    renderingObject: { getAttribute: () => ({ emission: 1, ...data }) },
    physicalObject: { getAttribute: () => radiusKm },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: {
      where: (_field: string, type: string) => ({
        first: () => (type === 'diffuse' ? { getAttribute: () => diffusePath } : undefined)
      })
    }
  } as unknown as Actor
}

describe('PlanetShader: ручки средней полосы', () => {
  beforeEach(() => {
    seedPlaceholderKeys()
    seedTexture(DIFFUSE_PATH, 8192, 4096)
  })
  afterEach(() => resourceStorage.deleteAllTextures())

  it('дефолты: strength 0, period 3 км, normalScale 1, slope 0.6, cavity 0.5, warp 1.5; радиус тела в юнитах', () => {
    const shader = new PlanetShader(stubActor(6371, {}))
    expect(shader.uniforms.uMacroStrength.value).toBe(0)
    expect(shader.uniforms.uMacroPeriodUnits.value).toBeCloseTo(toThreeJSUnits(3), 12)
    expect(shader.uniforms.uMacroNormalScale.value).toBe(1)
    expect(shader.uniforms.uMacroSlopeInfluence.value).toBe(0.6)
    expect(shader.uniforms.uMacroCavityInfluence.value).toBe(0.5)
    expect(shader.uniforms.uMacroTextureWarp.value).toBe(1.5)
    expect(shader.uniforms.uBodyRadiusUnits.value).toBeCloseTo(toThreeJSUnits(6371), 12)
  })

  it('fade по умолчанию — от радиуса и ширины загруженного диффуза, начало 0.4 × конца', () => {
    const shader = new PlanetShader(stubActor(6371, {}))
    const end = toThreeJSUnits(macroFadeMetersFor(6371, 8192) / 1000)
    const range = shader.uniforms.uMacroFadeRange.value as Vector2
    expect(range.y).toBeCloseTo(end, 12)
    expect(range.x).toBeCloseTo(0.4 * end, 12)
  })

  it('явный macroFadeMeters перекрывает расчёт', () => {
    const shader = new PlanetShader(stubActor(6371, { macroFadeMeters: 2e6 }))
    const range = shader.uniforms.uMacroFadeRange.value as Vector2
    expect(range.y).toBeCloseTo(toThreeJSUnits(2000), 12)
  })

  it('диффуз не загружен или радиус 0 — fade положительный минимум (нет деления на 0 в smoothstep)', () => {
    const shader = new PlanetShader(stubActor(0, {}, 'stub/macro/missing.png'))
    const range = shader.uniforms.uMacroFadeRange.value as Vector2
    expect(range.y).toBeGreaterThan(0)
    expect(range.x).toBeLessThan(range.y)
  })

  it('ручки из data доезжают; macroScaleKm — в юниты; uDiffuseTexelSize стартует нулями (ставит материал)', () => {
    const shader = new PlanetShader(stubActor(1737, { macroStrength: 0.25, macroScaleKm: 5, macroTextureWarp: 2 }))
    expect(shader.uniforms.uMacroStrength.value).toBe(0.25)
    expect(shader.uniforms.uMacroPeriodUnits.value).toBeCloseTo(toThreeJSUnits(5), 12)
    expect(shader.uniforms.uMacroTextureWarp.value).toBe(2)
    const texel = shader.uniforms.uDiffuseTexelSize.value as Vector2
    expect(texel.x).toBe(0)
    expect(texel.y).toBe(0)
  })
})
