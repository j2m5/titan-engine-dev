import { Color } from 'three'
import { Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { midbandCacheKey, midbandParamsOf, resolveMidbandParams } from '@/core/terrain/midbandParams'
import { readRenderingData } from '@/core/helpers/renderingData'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

/** Все ключи, по которым материал ходит через getTextureOrMake (плейсхолдер в jsdom падает на canvas). */
function seedFor(actor: Actor): void {
  for (const name of ['', 'default.png', 'night.jpg']) seedTexture(name)
  for (const resource of actor.resources.all()) seedTexture(resource.getAttribute('path') as string)
  for (const path of Object.values(STEEP_DETAIL_PATHS)) seedTexture(path)
}

/** Стаб тела: ручки в renderingObject.data, без ресурсов/атмосферы/колец. */
function stubActor(data: Record<string, unknown>): Actor {
  return {
    renderingObject: { getAttribute: () => ({ emission: 1, ...data }) },
    physicalObject: { getAttribute: () => 0 },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: {
      where: () => ({ first: () => undefined }),
      all: () => []
    }
  } as unknown as Actor
}

describe('Пресеты классов доезжают до юниформ', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  function materialOf(id: number): PlanetMaterial {
    const actor = Actor.find(id)!
    seedFor(actor)
    const material = new PlanetMaterial(actor)
    material.updateMaterial()
    return material
  }

  it('Европа (лёд): амбиент, окклюзия, steepTint, полоса B, террасы', () => {
    const m = materialOf(21)
    expect(m.uniforms.uTerrainAmbient.value).toBe(0.22)
    expect(m.uniforms.uTerrainOcclusionDirect.value).toBe(0.25)
    expect((m.uniforms.uSteepTint.value as Color).equals(new Color(0xd9d9d9))).toBe(true)
    expect(m.uniforms.uMidbandShade.value).toBe(0.35)
    expect(m.uniforms.uMacroTerraceStrength.value).toBe(0.2)
  })

  it('Луна (каменный безвоздушный): амбиент 0.10, прочее — дефолты', () => {
    const m = materialOf(19)
    expect(m.uniforms.uTerrainAmbient.value).toBe(0.1)
    expect(m.uniforms.uMidbandShade.value).toBe(0.5)
    expect(m.uniforms.uMacroStreakStrength.value).toBe(0.6)
  })

  it('Марс (песок с атмосферой): струи 0.7, террасы 0.3, амбиент 0.18', () => {
    const m = materialOf(8)
    expect(m.uniforms.uMacroStreakStrength.value).toBe(0.7)
    expect(m.uniforms.uMacroTerraceStrength.value).toBe(0.3)
    expect(m.uniforms.uTerrainAmbient.value).toBe(0.18)
  })

  it('Ио (вулканика): steepTint 0xf2f2f2', () => {
    expect((materialOf(20).uniforms.uSteepTint.value as Color).equals(new Color(0xf2f2f2))).toBe(true)
  })

  it('переопределение: стаб с terrainClass ice-airless — амбиент 0.22; с явным амбиентом — значение тела', () => {
    seedTexture(''); seedTexture('default.png'); seedTexture('night.jpg')
    expect(new PlanetMaterial(stubActor({ terrainClass: 'ice-airless' })).uniforms.uTerrainAmbient.value).toBe(0.22)
    expect(new PlanetMaterial(stubActor({ terrainClass: 'ice-airless', terrainAmbient: 0.05 })).uniforms.uTerrainAmbient.value).toBe(0.05)
  })

  it('ключ кеша полей высот не зависит от пресета', () => {
    const europa = Actor.find(21)!
    expect(midbandCacheKey(midbandParamsOf(europa))).toBe(midbandCacheKey(resolveMidbandParams(readRenderingData(europa), 'x')))
    expect(midbandParamsOf(europa).midbandShade).toBe(0.35)
  })
})
