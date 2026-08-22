import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture, Vector2 } from 'three'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import {
  DETAIL_FADE_START_RATIO,
  macroFadeMetersFor
} from '@/core/materials/shaders/lib/chunks/terrainMacroDetailMath'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'

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
      'applyTerrainMacroDetail(nLocal, albedoMul, dirLocal, eastLocal, macroSlope, macroCavity, uv, length(vViewPosition));'
    )
    const detail = frag.indexOf('applyTerrainDetail(nLocal, albedoMul, dirLocal, vDetailPos, vDetailPos2, length(vViewPosition));')
    const normalOut = frag.indexOf('normal = normalize(normalMatrix * nLocal);')
    expect(call).toBeGreaterThan(cavity)
    expect(call).toBeLessThan(detail)
    expect(detail).toBeLessThan(normalOut)
  })

  it('slope декодит хост из общей выборки; cavity — только под USE_CAVITY', () => {
    const gate = frag.indexOf('#ifdef USE_TERRAIN_MACRO_DETAIL', frag.indexOf('void main()'))
    const sample = frag.indexOf('vec4 macroSlopeSample = texture2D(bumpMap, uv);', gate)
    expect(sample).toBeGreaterThan(gate)
    expect(frag).toContain('vec2 macroSlope = (macroSlopeSample.xy * 255.0 - 128.0) * (uSlopeRange / 127.0);')
    expect(frag).not.toContain('(2.0 / 127.0)')
    // Присваивание канала B зажато между #ifdef USE_CAVITY и его #endif
    const cavityGate = frag.indexOf('#ifdef USE_CAVITY', sample)
    const cavityAssign = frag.indexOf('macroCavity = (macroSlopeSample.z * 255.0 - 128.0) / 127.0;', sample)
    const cavityEnd = frag.indexOf('#endif', cavityGate)
    expect(cavityAssign).toBeGreaterThan(cavityGate)
    expect(cavityAssign).toBeLessThan(cavityEnd)
    expect(frag.indexOf('float macroCavity = 0.0;', sample)).toBeLessThan(cavityGate)
  })

  it('noiseFunctions защищён от двойного включения собственным стражем', () => {
    expect(noiseFunctions).toContain('#ifndef TITAN_NOISE_INCLUDED')
    expect(noiseFunctions).toContain('#define TITAN_NOISE_INCLUDED')
    expect(noiseFunctions.trimEnd().endsWith('#endif')).toBe(true)
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
    expect(shader.uniforms.uMacroSlopeRef.value).toBe(0.08)
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

  it('macroSlopeRef из data доезжает и клампится положительным минимумом', () => {
    expect(new PlanetShader(stubActor(1737, { macroSlopeRef: 0.4 })).uniforms.uMacroSlopeRef.value).toBe(0.4)
    expect(new PlanetShader(stubActor(1737, { macroSlopeRef: 0 })).uniforms.uMacroSlopeRef.value).toBe(1e-3)
  })
})

const HEIGHT_PATH = 'stub/macro/height.raw'
const SLOPE_PATH = 'stub/macro/slope.webp'

function seedHeightField(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(HEIGHT_PATH, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

function stubTerraformActor(data: Record<string, unknown>, slopeResource: boolean = true): Actor {
  const pathByType: Record<string, string> = {
    diffuse: DIFFUSE_PATH,
    height: HEIGHT_PATH,
    ...(slopeResource ? { slope: SLOPE_PATH } : {})
  }
  return {
    renderingObject: { getAttribute: () => ({ emission: 1, ...data }) },
    physicalObject: { getAttribute: () => 1737 },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: {
      where: (_field: string, type: string) => ({
        first: () => {
          const path = pathByType[type]
          return path === undefined ? undefined : { getAttribute: () => path }
        }
      })
    }
  } as unknown as Actor
}

describe('PlanetMaterial: гейт USE_TERRAIN_MACRO_DETAIL и тексель диффуза', () => {
  beforeEach(() => {
    seedPlaceholderKeys()
    seedTexture(DIFFUSE_PATH, 8192, 4096)
  })
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
  })

  it('slope готова, macroStrength>0 — дефайн ставится', () => {
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)
    const material = new PlanetMaterial(stubTerraformActor({ macroStrength: 0.25 }))
    material.updateMaterial()
    expect(material.defines.USE_TERRAIN_MACRO_DETAIL).toBe('1')
  })

  it('macroStrength отсутствует или 0 — дефайна нет, набор defines идентичен телу без ручки', () => {
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)
    const without = new PlanetMaterial(stubTerraformActor({}))
    without.updateMaterial()
    const zero = new PlanetMaterial(stubTerraformActor({ macroStrength: 0 }))
    zero.updateMaterial()
    expect(without.defines.USE_TERRAIN_MACRO_DETAIL).toBeUndefined()
    expect(zero.defines).toEqual(without.defines)
  })

  it('без slope-карты дефайн не ставится даже при macroStrength>0', () => {
    seedHeightField()
    const material = new PlanetMaterial(stubTerraformActor({ macroStrength: 0.25 }, false))
    material.updateMaterial()
    expect(material.defines.USE_TERRAIN_MACRO_DETAIL).toBeUndefined()
  })

  it('карта высот не загружена — дефайна нет (гигантский и терраформный гейты взаимоисключающи)', () => {
    seedTexture(SLOPE_PATH, 8, 4)
    const material = new PlanetMaterial(stubTerraformActor({ macroStrength: 0.25, giantDetail: true }))
    material.updateMaterial()
    expect(material.defines.USE_TERRAIN_MACRO_DETAIL).toBeUndefined()
    expect(material.defines.USE_GIANT_DETAIL).toBe('1')
  })

  it('uDiffuseTexelSize — из размера загруженного диффуза; после reset — нули', () => {
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)
    const material = new PlanetMaterial(stubTerraformActor({ macroStrength: 0.25 }))
    material.updateMaterial()
    const texel = material.uniforms.uDiffuseTexelSize.value as Vector2
    expect(texel.x).toBeCloseTo(1 / 8192, 15)
    expect(texel.y).toBeCloseTo(1 / 4096, 15)
    material.resetMaterial()
    expect(texel.x).toBe(0)
    expect(texel.y).toBe(0)
  })

  it('диффуз ещё не загружен (плейсхолдер) — тексель нули, не размер плейсхолдера', () => {
    // PlaceholderTexture в jsdom требует канвас-контекст, которого тут нет —
    // тот же контракт «размер неизвестен → нули» проверяем картой без width/height.
    resourceStorage.deleteAllTextures()
    seedPlaceholderKeys()
    const placeholderSizedTexture = new Texture()
    placeholderSizedTexture.name = DIFFUSE_PATH
    placeholderSizedTexture.image = {}
    resourceStorage.addTexture(placeholderSizedTexture)
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)
    const material = new PlanetMaterial(stubTerraformActor({ macroStrength: 0.25 }))
    material.updateMaterial()
    const texel = material.uniforms.uDiffuseTexelSize.value as Vector2
    expect(texel.x).toBe(0)
    expect(texel.y).toBe(0)
  })

  it('конец fade пересчитывается в updateMaterial, когда диффуз доехал', () => {
    // Диффуз неизвестного размера на момент конструирования — в шейдере
    // диапазон вырожден в минимум; после загрузки карты материал его чинит.
    resourceStorage.deleteAllTextures()
    seedPlaceholderKeys()
    const unknownSized = new Texture()
    unknownSized.name = DIFFUSE_PATH
    unknownSized.image = {}
    resourceStorage.addTexture(unknownSized)
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)

    const material = new PlanetMaterial(stubTerraformActor({ macroStrength: 0.25 }))
    const range = material.uniforms.uMacroFadeRange.value as Vector2
    expect(range.y).toBeLessThanOrEqual(1.01e-6)

    resourceStorage.deleteTexture(DIFFUSE_PATH)
    seedTexture(DIFFUSE_PATH, 8192, 4096)
    material.updateMaterial()

    const end = toThreeJSUnits(macroFadeMetersFor(1737, 8192) / 1000)
    expect(range.y).toBeCloseTo(end, 12)
    expect(range.x).toBeCloseTo(DETAIL_FADE_START_RATIO * end, 12)
  })

  it('явный macroFadeMeters переживает updateMaterial без изменений', () => {
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)
    const material = new PlanetMaterial(stubTerraformActor({ macroStrength: 0.25, macroFadeMeters: 2e6 }))
    material.updateMaterial()
    const range = material.uniforms.uMacroFadeRange.value as Vector2
    expect(range.y).toBeCloseTo(toThreeJSUnits(2000), 12)
    expect(range.x).toBeCloseTo(DETAIL_FADE_START_RATIO * toThreeJSUnits(2000), 12)
  })
})
