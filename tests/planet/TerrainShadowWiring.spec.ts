import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Texture } from 'three'
import '@/core/framework/TitanThree'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { disposeTerrainShadowMaps } from '@/core/terrain/terrainShadowMap'

// Ручка силы живёт в renderingObject.data Луны, а ORM отдаёт НОВЫЙ экземпляр
// связи на каждое обращение — spy на модели не доживает до материала. Подмена
// на уровне резолвера ручек: обёртка над настоящим, override только на тест.
const shadowOverride = vi.hoisted(() => ({ strength: undefined as number | undefined }))

vi.mock('@/core/terrain/terrainLightParams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/terrain/terrainLightParams')>()

  return {
    ...actual,
    resolveTerrainLightParams: (data: Parameters<typeof actual.resolveTerrainLightParams>[0], context: string) => {
      const params = actual.resolveTerrainLightParams(data, context)

      return shadowOverride.strength === undefined ? params : { ...params, terrainShadowStrength: shadowOverride.strength }
    }
  }
})

const MOON_ID = 19
const MOON_HEIGHT_PATH = 'planets/moon/moon_height.raw'

function moon(): Actor {
  return Actor.find(MOON_ID)!
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

// Конструктор шейдера читает заглушки через getTextureOrMake — промах строит
// PlaceholderTexture (canvas 2d, в jsdom недоступен).
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

function seedHeightMap(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(MOON_HEIGHT_PATH, {
    width: 4,
    height: 2,
    // дно НЕ на нуле: иначе сброс uShadowHeightMin неотличим от его же привязки
    minMeters: 200,
    maxMeters: 1000,
    data: new Uint16Array([65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535])
  })
}

const frag: string = PlanetShaderTemplate.fragmentShader

describe('PlanetShaderTemplate: тень рельефа', () => {
  it('чанк включён только под USE_TERRAIN_SHADOW, внутри USE_TERRAIN_UV', () => {
    const start = frag.indexOf('#ifdef USE_TERRAIN_SHADOW')
    expect(start).toBeGreaterThan(-1)
    expect(frag.slice(start, frag.indexOf('#endif', start))).toContain('#include <terrainShadowMarchFunctions>')
    expect(frag.indexOf('#ifdef USE_TERRAIN_UV')).toBeLessThan(start)
  })

  it('множит только прямой свет, после строки directGain арки 3; амбиент не тронут', () => {
    const gain = frag.indexOf('float directGain = mix(1.0, occlusion, uTerrainOcclusionDirect) * cloudShadow;')
    const mul = frag.indexOf('directGain *= terrainShadow;')
    expect(gain).toBeGreaterThan(-1)
    expect(mul).toBeGreaterThan(gain)
    expect(frag).toContain('vec3 ambient = uTerrainAmbient * skyTerm * occlusion;')
    expect(frag).toContain('float terrainShadow = 1.0;')
    // марш не платится в амбиенте
    expect(frag).toContain('if (NdotLraw > 0.0) terrainShadow = mix(1.0, terrainShadowMarch(dirLocal, sunLocal), uTerrainShadowStrength);')
  })

  it('sunLocal объявлен до тени облаков и до марша', () => {
    const sun = frag.indexOf('vec3 sunLocal = -normalize(vLocalLightDirection);')
    expect(sun).toBeGreaterThan(-1)
    expect(sun).toBeLessThan(frag.indexOf('#ifdef USE_CLOUD_SHADOW'))
    expect(sun).toBeLessThan(frag.indexOf('terrainShadowMarch(dirLocal, sunLocal)'))
  })

  it('блики гасятся тенью: специальный и мокрой кромки', () => {
    expect(frag).toContain('* smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor * terrainShadow;')
    expect(frag.split('* ringShadowFactor * terrainShadow;').length - 1).toBe(2)
  })
})

describe('PlanetMaterial: гейт тени рельефа', () => {
  beforeEach(() => {
    seedPlaceholderKeys()
    seedHeightMap()
  })

  afterEach(() => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
    disposeTerrainShadowMaps()
  })

  it('с картой высот и strength 1 — дефайн и текстура; resetMaterial снимает', () => {
    const material = new PlanetMaterial(moon())
    material.updateMaterial()
    expect(material.defines.USE_TERRAIN_SHADOW).toBe('1')
    expect(material.uniforms.uShadowHeightMap.value).not.toBeNull()
    expect(material.uniforms.uShadowTexelAngle.value).toBeGreaterThan(0)
    expect(material.uniforms.uShadowHeightMin.value).toBeGreaterThan(0)
    material.resetMaterial()
    expect(material.defines.USE_TERRAIN_SHADOW).toBeUndefined()
    expect(material.uniforms.uShadowHeightMap.value).toBeNull()
    expect(material.uniforms.uShadowHeightMin.value).toBe(0)
    expect(material.uniforms.uShadowHeightRange.value).toBe(0)
    expect(material.uniforms.uShadowTexelAngle.value).toBe(0)
  })

  it('без карты высот дефайна нет', () => {
    heightFieldStorage.clear()
    const material = new PlanetMaterial(moon())
    material.updateMaterial()
    expect(material.defines.USE_TERRAIN_SHADOW).toBeUndefined()
    expect(material.uniforms.uShadowHeightMap.value).toBeNull()
  })

  it('strength 0 — дефайна нет, карта тени не строится', () => {
    shadowOverride.strength = 0
    try {
      const material = new PlanetMaterial(moon())
      material.updateMaterial()
      expect(material.defines.USE_TERRAIN_SHADOW).toBeUndefined()
      expect(material.uniforms.uShadowHeightMap.value).toBeNull()
      expect(material.uniforms.uTerrainShadowStrength.value).toBe(0)
    } finally {
      shadowOverride.strength = undefined
    }
  })
})
