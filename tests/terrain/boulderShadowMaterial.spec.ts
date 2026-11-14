import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Texture } from 'three'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { TerrainBoulderMaterial } from '@/core/materials/TerrainBoulderMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'

beforeEach(() => {
  vi.spyOn(heightFieldStorage, 'get').mockReturnValue({
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1,
    data: new Uint16Array(8)
  })
  const diffusePaths = [8, 21].map(
    (id) => Actor.find(id)!.resources.where('resourceType', 'diffuse').first()!.getAttribute('path')!
  )
  for (const name of ['', 'default.png', 'night.jpg', ...diffusePaths]) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  heightFieldStorage.clear()
  resourceStorage.deleteAllTextures()
})

it('retains shared shadow uniforms through streaming and resets their active state', () => {
  const mars = new TerrainMaterial(Actor.find(8)!),
    rocks = new TerrainBoulderMaterial(mars)
  try {
    const map = mars.uniforms.uBoulderShadowMap,
      strength = mars.uniforms.uBoulderShadowStrength
    for (let i = 0; i < 2; i++) {
      mars.updateMaterial()
      rocks.sync(mars)
      expect(mars.defines.USE_BOULDER_SHADOW).toBe('1')
      expect(rocks.defines.USE_BOULDER_SHADOW).toBe('1')
      expect(rocks.uniforms.uBoulderShadowMap).toBe(map)
      map.value = new Texture()
      strength.value = 1
      mars.resetMaterial()
      expect(strength.value).toBe(0)
      expect(map.value).toBeNull()
    }
  } finally {
    rocks.dispose()
    mars.dispose()
  }
})

it('does not add the shadow sampler to an ice shader', () => {
  const moon = new TerrainMaterial(Actor.find(21)!)
  try {
    moon.updateMaterial()
    expect(moon.defines.USE_BOULDER_SHADOW).toBeUndefined()
    expect(moon.uniforms.uBoulderShadowStrength.value).toBe(0)
  } finally {
    moon.dispose()
  }
})
