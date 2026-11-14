import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'

beforeEach(() => {
  for (const name of ['', 'default.png', 'night.jpg']) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
})
afterEach(() => resourceStorage.deleteAllTextures())

describe('bedrock talus material controls', () => {
  it('binds gravel color with the matching grain normal and clears both on reset', () => {
    const mars = Actor.find(8)!,
      material = new TerrainMaterial(mars)
    const add = (name: string) => {
      const texture = new Texture()
      texture.name = name
      texture.image = { width: 4, height: 2 }
      resourceStorage.addTexture(texture)
      return texture
    }
    try {
      add(mars.resources.where('resourceType', 'diffuse').first()!.getAttribute('path')!)
      const color = add('terrain/rocky_trail_diff.webp')
      material.updateMaterial()
      expect(material.uniforms.uTalusGate?.value).toBe(0)
      add('terrain/rocky_trail_nor.webp')
      material.updateMaterial()
      expect(material.uniforms.uTalusGate?.value).toBe(1)
      expect(material.uniforms.uTalusDiffMap?.value).toBe(color)
      expect(material.uniforms.uTalusTintNorm?.value).toBeCloseTo(1 / 0.233, 5)
      material.resetMaterial()
      expect(material.uniforms.uTalusGate?.value).toBe(0)
      expect(material.uniforms.uTalusDiffMap?.value).toBeNull()
    } finally {
      material.dispose()
    }
  })

  it('follows the physical Mars field and uses the granular normal detail', () => {
    const mars = Actor.find(8)!
    const material = new TerrainMaterial(mars)
    try {
      expect(material.uniforms.uBedrockShape?.value.toArray()).toEqual([0.45, 800, 1, 3390000])
      expect(material.uniforms.uBedrockWater?.value.toArray()).toEqual([0, 0])
      expect(mars.resources.where('resourceType', 'detailNormal2').first()?.getAttribute('path')).toBe(
        'terrain/rocky_trail_nor.webp'
      )
    } finally {
      material.dispose()
    }
  })

  it('leaves the Moon material disabled', () => {
    const material = new TerrainMaterial(Actor.find(19)!)
    try {
      expect(material.uniforms.uBedrockShape?.value.x).toBe(0)
    } finally {
      material.dispose()
    }
  })
})
