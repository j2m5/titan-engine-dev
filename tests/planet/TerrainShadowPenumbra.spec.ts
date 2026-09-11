import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resolveStarRadiusKm } from '@/core/terrain/starRadius'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { TERRAIN_SHADOW_PENUMBRA_FLOOR } from '@/core/materials/shaders/lib/chunks/terrainShadowMath'
import { resourceStorage } from '@/core/services/ResourceStorage'

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

  it('Луна без атмосферы: R★/dist с полом; softness множит', () => {
    const material = new PlanetMaterial(Actor.find(19)!)
    material.syncTerrainShadow(new Vector3(toThreeJSUnits(1.5e8), 0, 0))
    expect(material.uniforms.uShadowPenumbraTan.value).toBeCloseTo(Math.max(696000 / 1.5e8, TERRAIN_SHADOW_PENUMBRA_FLOOR), 12)
  })

  it('Земля с атмосферой: tan(sunAngularRadius) из данных атмосферы, дистанция не при чём', () => {
    const material = new PlanetMaterial(Actor.find(7)!)
    material.syncTerrainShadow(new Vector3(toThreeJSUnits(1), 0, 0))
    const expected = Math.max(Math.tan(0.00465043373641781), TERRAIN_SHADOW_PENUMBRA_FLOOR)
    expect(material.uniforms.uShadowPenumbraTan.value).toBeCloseTo(expected, 12)
  })
})
