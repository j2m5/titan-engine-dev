import { DataTexture, NearestFilter, NoColorSpace, RedFormat, UnsignedByteType } from 'three'
import { vi } from 'vitest'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'

describe('nebula sampling', () => {
  it.each([NaN, Infinity, -Infinity])('defaults nonfinite resolution scale (%s)', invalid => {
    expect(mergeNebulaParams({ quality: { resolutionScale: invalid } }).quality.resolutionScale).toBe(1)
  })

  it('owns a deterministic nearest-filtered linear R8 noise texture', () => {
    const a = new NebulaRaymarchMaterial(mergeNebulaParams()), b = new NebulaRaymarchMaterial(mergeNebulaParams())
    try {
      expect(a.uniforms.uBlueNoise).toBeDefined()
      const first = a.uniforms.uBlueNoise.value as DataTexture, second = b.uniforms.uBlueNoise.value as DataTexture
      expect(first).toBeInstanceOf(DataTexture)
      expect(first).not.toBe(second)
      expect(first.image).toMatchObject({ width: 64, height: 64 })
      expect(first.image.data).toEqual(second.image.data)
      expect(first.format).toBe(RedFormat)
      expect(first.type).toBe(UnsignedByteType)
      expect(first.minFilter).toBe(NearestFilter)
      expect(first.magFilter).toBe(NearestFilter)
      expect(first.colorSpace).toBe(NoColorSpace)
      expect(first.generateMipmaps).toBe(false)
      const disposed = vi.fn()
      first.addEventListener('dispose', disposed)
      a.dispose()
      expect(disposed).toHaveBeenCalledOnce()
      expect(b.uniforms.uBlueNoise.value).toBe(second)
    } finally { b.dispose() }
  })

  it('has a uniform histogram and suppresses low frequencies at several thresholds', () => {
    const material = new NebulaRaymarchMaterial(mergeNebulaParams())
    try {
      expect(material.uniforms.uBlueNoise).toBeDefined()
      const { data, width } = (material.uniforms.uBlueNoise.value as DataTexture).image
      const values = data as Uint8Array, histogram = new Array<number>(256).fill(0)
      for (const value of values) histogram[value]++
      expect(histogram.every(count => count === 16)).toBe(true)
      for (const threshold of [32, 128, 224]) {
        const probability = threshold / 256
        let power = 0, modes = 0
        for (let fy = -3; fy <= 3; fy++) for (let fx = -3; fx <= 3; fx++) {
          if (fx === 0 && fy === 0) continue
          let real = 0, imaginary = 0
          for (let i = 0; i < values.length; i++) {
            const sample = (values[i] < threshold ? 1 : 0) - probability
            const phase = 2 * Math.PI * (fx * (i % width) + fy * Math.floor(i / width)) / width
            real += sample * Math.cos(phase)
            imaginary += sample * Math.sin(phase)
          }
          power += (real * real + imaginary * imaginary) / values.length
          modes++
        }
        // White-noise expected power is p(1-p); blue noise has a spectral hole.
        expect(power / modes).toBeLessThan(probability * (1 - probability) * 0.15)
      }
    } finally { material.dispose() }
  })
})
