import { describe, it, expect } from 'vitest'
import { LinearFilter, type Mesh } from 'three'
import { createCloudTextures } from '@/core/clouds/takram/cloudTextures'

describe('owned pinned procedural cloud textures', () => {
  it('keeps the single-level density sampling contract for both owned volumes', () => {
    const textures = createCloudTextures()
    try {
      for (const texture of [textures.shape.texture, textures.detail.texture]) {
        expect(texture.minFilter).toBe(LinearFilter)
        expect(texture.magFilter).toBe(LinearFilter)
        expect(texture.generateMipmaps).toBe(false)
      }
    } finally {
      textures.dispose()
    }
  })
  it('disposes both distinct instance geometries and noise exactly once', () => {
    const textures = createCloudTextures()
    const shapeGeometry = (textures.shape as unknown as { mesh: Mesh }).mesh.geometry
    const detailGeometry = (textures.detail as unknown as { mesh: Mesh }).mesh.geometry
    expect(shapeGeometry).not.toBe(detailGeometry)
    const counts = [0, 0, 0]
    ;[shapeGeometry, detailGeometry, textures.noise].forEach((resource, index) => {
      resource.addEventListener('dispose', () => counts[index]++)
    })
    textures.dispose()
    textures.dispose()
    expect(counts).toEqual([1, 1, 1])
  })
  it('continues releasing owned resources when a public upstream dispose throws', () => {
    const textures = createCloudTextures()
    const shapeGeometry = (textures.shape as unknown as { mesh: Mesh }).mesh.geometry
    const detailGeometry = (textures.detail as unknown as { mesh: Mesh }).mesh.geometry
    const counts = [0, 0, 0]
    ;[shapeGeometry, detailGeometry, textures.noise].forEach((resource, index) => {
      resource.addEventListener('dispose', () => counts[index]++)
    })
    const upstream = textures.shape.dispose.bind(textures.shape)
    textures.shape.dispose = () => {
      upstream()
      throw Error('fixture public dispose failure')
    }
    expect(() => textures.dispose()).toThrow(/dispose failure/)
    expect(counts).toEqual([1, 1, 1])
    textures.dispose()
    expect(counts).toEqual([1, 1, 1])
  })
})
