import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Texture, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resolveStarRadiusKm } from '@/core/terrain/starRadius'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { TERRAIN_SHADOW_PENUMBRA_FLOOR } from '@/core/materials/shaders/lib/chunks/terrainShadowMath'
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
}

describe('resolveStarRadiusKm', () => {
  it('Луна → Солнце (категория 3 у корня дерева) → 696000 км', () => {
    expect(resolveStarRadiusKm(Actor.find(19)!)).toBe(696000)
  })

  it('стаб без parent/children → undefined', () => {
    expect(resolveStarRadiusKm({} as unknown as Actor)).toBeUndefined()
  })
})

describe('PlanetMaterial.syncTerrainShadow', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('Луна без атмосферы: R★/dist на дистанции, где пол не доминирует', () => {
    const material = new PlanetMaterial(Actor.find(19)!)
    material.syncTerrainShadow(new Vector3(toThreeJSUnits(1e8), 0, 0))
    expect(material.uniforms.uShadowPenumbraTan.value).toBeCloseTo(Math.max(696000 / 1e8, TERRAIN_SHADOW_PENUMBRA_FLOOR), 12)
  })

  it('Луна без атмосферы: на большей дистанции побеждает пол полутени', () => {
    const material = new PlanetMaterial(Actor.find(19)!)
    material.syncTerrainShadow(new Vector3(toThreeJSUnits(1.5e8), 0, 0))
    expect(material.uniforms.uShadowPenumbraTan.value).toBe(TERRAIN_SHADOW_PENUMBRA_FLOOR)
  })

  it('softness множит итог', () => {
    softnessOverride.value = 2
    try {
      const material = new PlanetMaterial(Actor.find(19)!)
      material.updateMaterial()
      material.syncTerrainShadow(new Vector3(toThreeJSUnits(1e8), 0, 0))
      expect(material.uniforms.uShadowPenumbraTan.value).toBeCloseTo(2 * (696000 / 1e8), 12)
    } finally {
      softnessOverride.value = undefined
    }
  })

  it('Земля с атмосферой: tan(sunAngularRadius) из данных атмосферы, дистанция не при чём', () => {
    const material = new PlanetMaterial(Actor.find(7)!)
    material.syncTerrainShadow(new Vector3(toThreeJSUnits(1), 0, 0))
    const expected = Math.max(Math.tan(0.00465043373641781), TERRAIN_SHADOW_PENUMBRA_FLOOR)
    expect(material.uniforms.uShadowPenumbraTan.value).toBeCloseTo(expected, 12)
  })
})
