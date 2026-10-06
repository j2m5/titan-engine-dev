import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Texture, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { SphereSurfaceMaterial } from '@/core/materials/SphereSurfaceMaterial'
import { Planet } from '@/core/renderables/Planet'
import { Actor } from '@/core/models/Actor'
import { resolveStarRadiusKm } from '@/core/terrain/starRadius'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { TERRAIN_SHADOW_PENUMBRA_FLOOR } from '@/core/materials/shaders/lib/chunks/terrainShadowMath'
import { readRenderingData } from '@/core/helpers/renderingData'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { resourceStorage } from '@/core/services/ResourceStorage'

// Ручка мягкости живёт в renderingObject.data — подмена резолвера, тот же
// приём, что shadowOverride в TerrainShadowWiring.spec.ts (ORM отдаёт новый
// экземпляр связи на каждое обращение, spy на модели не доживает до материала).
const softnessOverride = vi.hoisted(() => ({ value: undefined as number | undefined }))

vi.mock('@/core/terrain/terrainLightParams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/terrain/terrainLightParams')>()

  return {
    ...actual,
    resolveTerrainLightParams: (data: Parameters<typeof actual.resolveTerrainLightParams>[0], context: string) => {
      const params = actual.resolveTerrainLightParams(data, context)

      return softnessOverride.value === undefined ? params : { ...params, terrainShadowSoftness: softnessOverride.value }
    }
  }
})

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

// Конструктор шейдера читает заглушки через getTextureOrMake — промах строит
// PlaceholderTexture (canvas 2d, в jsdom недоступен), см. TerrainShadowWiring.spec.ts.
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(Actor.find(19)!.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
  seedTexture(Actor.find(7)!.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
  const saturn = Actor.find(SATURN_ID)!
  seedTexture(saturn.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
  seedTexture(saturn.children.where('categoryId', 6).first()!.resources.first()!.getAttribute('path') as string)
}

/** Сатурн — сфера Planet с кольцом */
const SATURN_ID = 11

describe('resolveStarRadiusKm', () => {
  it('Луна → Солнце (категория 3 у корня дерева) → 696000 км', () => {
    expect(resolveStarRadiusKm(Actor.find(19)!)).toBe(696000)
  })

  it('стаб без parent/children → undefined', () => {
    expect(resolveStarRadiusKm({} as unknown as Actor)).toBeUndefined()
  })
})

describe('SphereSurfaceMaterial.syncRingShadow', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  /** Угловой радиус солнца из атмосферы Сатурна — честный тангенс кольцу, без пола */
  function saturnSunTan(): number {
    const atm = Actor.find(SATURN_ID)!.children.where('categoryId', 5).first()!
    return Math.tan(readRenderingData<AtmosphereConfig>(atm)!.sunAngularRadius!)
  }

  it('сфера с кольцом: uRingSunTan — tan(sunAngularRadius) атмосферы, ниже пола полутени рельефа', () => {
    const material = new SphereSurfaceMaterial(Actor.find(SATURN_ID)!)
    material.syncRingShadow(new Vector3(toThreeJSUnits(1.43e9), 0, 0))
    expect(material.uniforms.uRingSunTan.value).toBeCloseTo(saturnSunTan(), 12)
    expect(material.uniforms.uRingSunTan.value).toBeLessThan(TERRAIN_SHADOW_PENUMBRA_FLOOR)
  })

  it('Planet.updateObject пишет полутень кольца своему материалу', () => {
    const planet = new Planet(Actor.find(SATURN_ID)!)
    planet.position.set(toThreeJSUnits(1.43e9), 0, 0)
    planet.updateObject({ camera: new PerspectiveCamera(), delta: 0, epoch: 0, elapsed: 0 })
    expect(planet.material.uniforms.uRingSunTan.value).toBeCloseTo(saturnSunTan(), 12)
  })
})

describe('TerrainMaterial.syncTerrainShadow', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('Луна без атмосферы: R★/dist на дистанции, где пол не доминирует', () => {
    const material = new TerrainMaterial(Actor.find(19)!)
    material.syncTerrainShadow(new Vector3(toThreeJSUnits(1e8), 0, 0))
    expect(material.uniforms.uShadowPenumbraTan.value).toBeCloseTo(Math.max(696000 / 1e8, TERRAIN_SHADOW_PENUMBRA_FLOOR), 12)
  })

  it('Луна без атмосферы: на большей дистанции побеждает пол полутени', () => {
    const material = new TerrainMaterial(Actor.find(19)!)
    material.syncTerrainShadow(new Vector3(toThreeJSUnits(1.5e8), 0, 0))
    expect(material.uniforms.uShadowPenumbraTan.value).toBe(TERRAIN_SHADOW_PENUMBRA_FLOOR)
  })

  it('uRingSunTan — честный tan(sunAngularRadius) атмосферы, без пола полутени', () => {
    const earth = Actor.find(7)!
    const atm = earth.children.where('categoryId', 5).first()!
    const ang = readRenderingData<AtmosphereConfig>(atm)!.sunAngularRadius
    const material = new TerrainMaterial(earth)
    material.syncTerrainShadow(new Vector3(toThreeJSUnits(1.5e8), 0, 0))
    expect(material.uniforms.uRingSunTan.value).toBeCloseTo(Math.tan(ang), 12)
    expect(material.uniforms.uShadowPenumbraTan.value).toBeGreaterThanOrEqual(TERRAIN_SHADOW_PENUMBRA_FLOOR)
  })

  it('Луна: uRingSunTan без пола (R★/dist ниже пола остаётся как есть)', () => {
    const material = new TerrainMaterial(Actor.find(19)!)
    material.syncTerrainShadow(new Vector3(toThreeJSUnits(1.5e8), 0, 0))
    expect(material.uniforms.uRingSunTan.value).toBeCloseTo(696000 / 1.5e8, 12)
    expect(material.uniforms.uRingSunTan.value).toBeLessThan(TERRAIN_SHADOW_PENUMBRA_FLOOR)
  })

  it('softness множит итог', () => {
    softnessOverride.value = 2
    try {
      const material = new TerrainMaterial(Actor.find(19)!)
      material.updateMaterial()
      material.syncTerrainShadow(new Vector3(toThreeJSUnits(1e8), 0, 0))
      expect(material.uniforms.uShadowPenumbraTan.value).toBeCloseTo(2 * (696000 / 1e8), 12)
    } finally {
      softnessOverride.value = undefined
    }
  })

  it('Земля с атмосферой: tan(sunAngularRadius) из данных атмосферы, дистанция не при чём', () => {
    const material = new TerrainMaterial(Actor.find(7)!)
    material.syncTerrainShadow(new Vector3(toThreeJSUnits(1), 0, 0))
    const expected = Math.max(Math.tan(0.00465043373641781), TERRAIN_SHADOW_PENUMBRA_FLOOR)
    expect(material.uniforms.uShadowPenumbraTan.value).toBeCloseTo(expected, 12)
  })
})
