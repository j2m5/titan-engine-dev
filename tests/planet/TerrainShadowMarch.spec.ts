import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import '@/core/framework/TitanThree'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { terrainShadowMarchFunctions, terrainShadowMarchUniforms } from '@/core/materials/shaders/lib/chunks/TerrainShadowMarch'
import { TERRAIN_SHADOW_BIAS_SLOPE, TERRAIN_SHADOW_STEPS } from '@/core/materials/shaders/lib/chunks/terrainShadowMath'
import { resolveTerrainLightParams } from '@/core/terrain/terrainLightParams'
import { config } from '@/core/framework/config'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resourceStorage } from '@/core/services/ResourceStorage'

// Конструктор PlanetShader читает 'default.png'/'night.jpg'/'' заглушками через
// getTextureOrMake — промах строит PlaceholderTexture (canvas 2d, недоступен в jsdom).
function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg']) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
}

describe('TerrainShadowMarch: чанк', () => {
  it('зарегистрирован для #include', () => {
    expect(AppShaderChunk.terrainShadowMarchUniforms).toBe(terrainShadowMarchUniforms)
    expect(AppShaderChunk.terrainShadowMarchFunctions).toBe(terrainShadowMarchFunctions)
  })

  it('константы — из CPU-зеркала', () => {
    expect(terrainShadowMarchFunctions).toContain(`#define TERRAIN_SHADOW_STEPS ${TERRAIN_SHADOW_STEPS}`)
    expect(terrainShadowMarchFunctions).toContain(`#define TERRAIN_SHADOW_BIAS_SLOPE ${TERRAIN_SHADOW_BIAS_SLOPE}`)
    // Литералы буквально: интерполяция той же константы формы не доказывает, а
    // целая константа дала бы `float * int` — в GLSL ES 1.0 ошибка компиляции.
    expect(terrainShadowMarchFunctions).toContain('#define TERRAIN_SHADOW_STEPS 20')
    expect(terrainShadowMarchFunctions).toContain('#define TERRAIN_SHADOW_BIAS_SLOPE 0.05')
  })

  it('без производных (мипов нет, fwidth в цикле с break не определён); v — север на 0', () => {
    expect(terrainShadowMarchFunctions).not.toContain('fwidth')
    expect(terrainShadowMarchFunctions).not.toContain('dFdx')
    expect(terrainShadowMarchFunctions).toContain('acos(clamp(dirLocal.y, -1.0, 1.0)) / 3.14159265358979323846')
    expect(terrainShadowMarchFunctions).toContain('if (cosSun <= 0.0) return 1.0;')
    expect(terrainShadowMarchFunctions).toContain('if (occl >= 1.0) break;')
  })

  it('юниформы объявлены в чанке', () => {
    for (const name of ['uShadowHeightMap', 'uShadowHeightMin', 'uShadowHeightRange', 'uShadowTexelAngle', 'uShadowMaxDistUnits', 'uShadowPenumbraTan', 'uTerrainShadowStrength']) {
      expect(terrainShadowMarchUniforms).toContain(name)
    }
  })

  it('тело марша — построчно как в CPU-зеркале', () => {
    for (const line of [
      'vec3 p0 = dir * (R + terrainShadowHeight(dir));',
      'float texel = R * uShadowTexelAngle;',
      'float bias = texel * TERRAIN_SHADOW_BIAS_SLOPE;',
      'float sMin = texel * 2.0;',
      'float sMax = max(uShadowMaxDistUnits, sMin * 2.0);',
      'float ratio = pow(sMax / sMin, 1.0 / float(TERRAIN_SHADOW_STEPS - 1));',
      'float hRay = r - R;',
      'float pen = (terrainShadowHeight(d) - hRay - bias) / max(s * uShadowPenumbraTan, 1e-6);',
      'occl = max(occl, clamp(pen, 0.0, 1.0));',
      's *= ratio;',
      'return 1.0 - occl;'
    ]) {
      expect(terrainShadowMarchFunctions).toContain(line)
    }
  })
})

describe('ручки тени рельефа', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('дефолты: strength 1, softness 1; валидация громкая', () => {
    const p = resolveTerrainLightParams(undefined, 'x')
    expect(p.terrainShadowStrength).toBe(1)
    expect(p.terrainShadowSoftness).toBe(1)
    expect(() => resolveTerrainLightParams({ terrainShadowStrength: 1.5 }, 'x')).toThrow('[0, 1]')
    expect(() => resolveTerrainLightParams({ terrainShadowSoftness: 0 }, 'x')).toThrow('> 0')
    expect(() => resolveTerrainLightParams({ terrainShadowSoftness: 'a' }, 'x')).toThrow('не число')
  })

  it('config terrain.shadowMaxKm = 150', () => {
    expect(config('terrain.shadowMaxKm')).toBe(150)
  })

  it('PlanetShader заводит юниформы тени с дефолтами', () => {
    const { uniforms } = new PlanetShader(Actor.find(19)!)
    expect(uniforms.uShadowHeightMap.value).toBeNull()
    expect(uniforms.uShadowHeightMin.value).toBe(0)
    expect(uniforms.uShadowHeightRange.value).toBe(0)
    expect(uniforms.uShadowTexelAngle.value).toBe(0)
    expect(uniforms.uShadowMaxDistUnits.value).toBeCloseTo(toThreeJSUnits(150), 12)
    expect(uniforms.uShadowPenumbraTan.value).toBeCloseTo(Math.tan(0.0093), 12)
    expect(uniforms.uTerrainShadowStrength.value).toBe(1)
  })
})
