import { describe, expect, it, vi } from 'vitest'
import { DataTexture, FloatType, NearestFilter, RepeatWrapping } from 'three'
import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'

function lookup(material: RingDustRaymarchMaterial): DataTexture {
  const texture = material.uniforms.uDustClumpGradients?.value
  expect(texture).toBeInstanceOf(DataTexture)
  return texture as DataTexture
}

describe('dust clump gradient resource', () => {
  it('only allocates a nearest, periodic float lookup for clumpy dust', () => {
    const plain = new RingDustRaymarchMaterial()
    const clumpy = new RingDustRaymarchMaterial(undefined, { clumps: true })
    try {
      expect(plain.uniforms.uDustClumpGradients).toBeUndefined()
      const texture = lookup(clumpy)
      expect(texture.image.width).toBe(289)
      expect(texture.image.height).toBe(289)
      expect(texture.type).toBe(FloatType)
      expect(texture.minFilter).toBe(NearestFilter)
      expect(texture.magFilter).toBe(NearestFilter)
      expect(texture.wrapS).toBe(RepeatWrapping)
      expect(texture.wrapT).toBe(RepeatWrapping)
      expect(texture.generateMipmaps).toBe(false)
      expect(texture.image.data?.byteLength).toBe(1336336)
    } finally { plain.dispose(); clumpy.dispose() }
  })

  it('disposes its own lookup and gives clones independent texture lifetimes', () => {
    const original = new RingDustRaymarchMaterial(undefined, { clumps: true })
    const cloned = original.clone()
    try {
      const first = lookup(original), second = lookup(cloned)
      expect(second).not.toBe(first)
      expect(second.image.data).toEqual(first.image.data)
      const onFirst = vi.fn(), onSecond = vi.fn()
      first.addEventListener('dispose', onFirst)
      second.addEventListener('dispose', onSecond)
      original.dispose()
      expect(onFirst).toHaveBeenCalledOnce()
      expect(onSecond).not.toHaveBeenCalled()
      cloned.dispose()
      expect(onSecond).toHaveBeenCalledOnce()
    } finally { original.dispose(); cloned.dispose() }
  })

  it('releases the previous lookup on copy and adopts the cloned resource', () => {
    const source = new RingDustRaymarchMaterial(undefined, { clumps: true })
    const target = new RingDustRaymarchMaterial(undefined, { clumps: true })
    const plain = new RingDustRaymarchMaterial()
    try {
      const previous = lookup(target), onPrevious = vi.fn()
      previous.addEventListener('dispose', onPrevious)
      target.copy(source)
      expect(onPrevious).toHaveBeenCalledOnce()
      const replacement = lookup(target), onReplacement = vi.fn()
      expect(replacement).not.toBe(lookup(source))
      replacement.addEventListener('dispose', onReplacement)
      target.copy(target)
      expect(lookup(target)).toBe(replacement)
      expect(onReplacement).not.toHaveBeenCalled()
      target.copy(plain)
      expect(onReplacement).toHaveBeenCalledOnce()
      expect(target.uniforms.uDustClumpGradients).toBeUndefined()
    } finally { source.dispose(); target.dispose(); plain.dispose() }
  })
})
