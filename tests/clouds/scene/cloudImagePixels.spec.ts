import { describe, expect, it, vi } from 'vitest'
import { DataTexture, Texture, SRGBColorSpace } from 'three'
import { readCloudImagePixels } from '@/core/clouds/appearance/cloudImagePixels'
import { prepareCloudAppearanceTextures } from '@/core/clouds/appearance/cloudAppearanceTextures'
import { createJupiterCloudProfile } from '@/core/clouds/profiles/jupiterCloudProfile'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'

describe('canonical cloud image pixels', () => {
  it.each([26, 37])('resolves authored RGB scattering map %s independently of the density decoder', (id) => {
    const density = new DataTexture(new Uint8Array([64, 64, 64, 255]), 1, 1)
    const color = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1)
    color.colorSpace = SRGBColorSpace
    const config = createEarthCloudProfile()
    config.layers[0].color = { kind: 'map', map: { resourceId: id }, strength: 0.7 }
    const selected = id === 26 ? density : color
    const before = [selected.version, selected.source.version]
    const prepared = prepareCloudSource(config, (resourceId) =>
      resourceId === 26 ? density : resourceId === 37 ? color : undefined
    )
    expect((prepared.textures.weather.image.data as Uint8Array)[0]).toBe(128)
    expect((prepared.textures.color as DataTexture).image.data).toBe(selected.image.data)
    expect(prepared.textures.color!.source).not.toBe(selected.source)
    expect(prepared.textures.colorStrength).toBe(0.7)
    expect([selected.version, selected.source.version]).toEqual(before)
    const sourceDispose = vi.spyOn(selected, 'dispose'),
      viewDispose = vi.spyOn(prepared.textures.color!, 'dispose')
    prepared.dispose()
    prepared.dispose()
    expect(viewDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    density.dispose()
    color.dispose()
  })
  it('releases already prepared weather if an authored RGB color source is unavailable', () => {
    const source = new DataTexture(new Uint8Array([64, 64, 64, 255]), 1, 1)
    const config = createEarthCloudProfile()
    config.layers[0].color = { kind: 'map', map: { resourceId: 37 }, strength: 1 }
    const disposed: unknown[] = []
    const originalDispose = DataTexture.prototype.dispose
    const spy = vi.spyOn(DataTexture.prototype, 'dispose').mockImplementation(function (this: DataTexture) {
      disposed.push(this)
      originalDispose.call(this)
    })
    try {
      expect(() => prepareCloudSource(config, (id) => (id === 26 ? source : undefined))).toThrow(/37/)
      expect(disposed).toHaveLength(1)
      expect(disposed).not.toContain(source)
    } finally {
      spy.mockRestore()
      source.dispose()
    }
  })
  it('reduces scalar image coverage after nonlinear decoding', () => {
    const image = document.createElement('img')
    Object.defineProperties(image, {
      naturalWidth: { value: 2048 },
      naturalHeight: { value: 1 },
      complete: { value: true }
    })
    const bytes = new Uint8ClampedArray(2048 * 4)
    for (let i = 0; i < 2048; i++) {
      bytes[i * 4] = i % 2 ? 255 : 0
      bytes[i * 4 + 3] = 255
    }
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage() {},
      getImageData() {
        return { data: bytes }
      }
    } as never)
    const layer = createJupiterCloudProfile().layers[0]
    layer.pattern = {
      kind: 'mask',
      encoding: 'scalar',
      map: { resourceId: 32 },
      decode: { channel: 'r', inputRange: [0, 1], exponent: 2, invert: false, sampleSpace: 'linear' }
    }
    layer.color = { kind: 'constant', srgb: [1, 1, 1] }
    try {
      const prepared = prepareCloudAppearanceTextures(layer, () => new Texture(image))
      expect(prepared.weather.image.width).toBe(1024)
      expect((prepared.weather.image.data as Uint8Array)[0]).toBe(128)
      prepared.dispose()
    } finally {
      context.mockRestore()
    }
  })
  it('normalizes RGB separately from immutable scalar descriptors and white scattering', () => {
    const source = new DataTexture(new Uint8Array([64, 64, 64, 255]), 1, 1)
    const config = createEarthCloudProfile()
    const before = structuredClone(config)
    const prepared = prepareCloudSource(config, () => source)
    expect(config).toEqual(before)
    expect(prepared.config).not.toBe(config)
    expect(prepared.config.layers[0].pattern).toMatchObject({
      kind: 'mask',
      encoding: 'scalar',
      decode: { channel: 'r', exponent: 1 }
    })
    expect((prepared.textures.weather.image.data as Uint8Array)[0]).toBe(128)
    expect(prepared.textures.color).toBeNull()
    expect(prepared.textures.constantColorLinear).toEqual([1, 1, 1])
    const normalized = structuredClone(prepared.config)
    const scalar = prepareCloudSource(normalized, () => source)
    expect((scalar.textures.weather.image.data as Uint8Array)[0]).toBe(64)
    expect(normalized).toEqual(prepared.config)
    prepared.dispose()
    scalar.dispose()
    source.dispose()
  })
  it.each([false, true])('returns bottom-origin four-corner bytes exactly once, flipY=%s', (flipY) => {
    const bytes = new Uint8Array([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255])
    const source = new DataTexture(bytes, 2, 2)
    source.flipY = flipY
    const pixels = readCloudImagePixels(source)
    expect(pixels.rowOrigin).toBe('bottom')
    expect(Array.from(pixels.bytes).filter((_, i) => i % 4 === 0)).toEqual(flipY ? [30, 40, 10, 20] : [10, 20, 30, 40])
    expect(source.image.data).toBe(bytes)
    source.dispose()
  })
  it('gives sampler views independent Sources and preserves borrowed versions and ownership', () => {
    const source = new DataTexture(new Uint8Array([128, 64, 32, 255]), 1, 1)
    source.colorSpace = SRGBColorSpace
    const before = [source.colorSpace, source.wrapS, source.wrapT, source.flipY, source.version, source.source.version]
    const dispose = vi.spyOn(source, 'dispose')
    const layer = createJupiterCloudProfile().layers[0]
    const maps = prepareCloudAppearanceTextures(layer, () => source)
    expect(maps.color!.source).not.toBe(source.source)
    expect((maps.color as DataTexture).image.data).toBe(source.image.data)
    expect([
      source.colorSpace,
      source.wrapS,
      source.wrapT,
      source.flipY,
      source.version,
      source.source.version
    ]).toEqual(before)
    maps.color!.needsUpdate = true
    maps.dispose()
    maps.dispose()
    expect(dispose).not.toHaveBeenCalled()
    expect(source.source.version).toBe(before[5])
    source.dispose()
  })
})
