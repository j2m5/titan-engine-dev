import { describe, expect, it, vi } from 'vitest'
import { Color, DataTexture, Texture, RGBAFormat, SRGBColorSpace, NoColorSpace } from 'three'
import { decodeRgbCloud } from '@/core/clouds/appearance/rgbCloudMap'
import { prepareRgbCloudTextures } from '@/core/clouds/appearance/rgbCloudTextures'
import { readCloudImagePixels } from '@/core/clouds/appearance/cloudImagePixels'
import { prepareCloudAppearanceTextures } from '@/core/clouds/appearance/cloudAppearanceTextures'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'

const texture = (values: number[], width: number, height: number) =>
  new DataTexture(new Uint8Array(values.flatMap((x) => [x, x, x, 255])), width, height, RGBAFormat)
describe('Earth RGB cloud preparation', () => {
  it('keeps the 2048 width ceiling even when callers request a larger bound', () => {
    const source = texture(new Array(4096).fill(255), 4096, 1)
    const maps = prepareRgbCloudTextures(source, { maxWidth: 4096 })
    expect(maps.weather.image.width).toBe(2048)
    maps.dispose()
    source.dispose()
  })
  it('bounds tall sources by height while preserving aspect', () => {
    const source = texture(new Array(2 * 2048).fill(255), 2, 2048)
    const maps = prepareRgbCloudTextures(source)
    expect([maps.weather.image.width, maps.weather.image.height]).toEqual([1, 1024])
    maps.dispose()
    source.dispose()
  })
  it('selects white scattering without changing weather or owning a color map', () => {
    const source = texture([0, 64, 128, 255], 2, 2)
    source.colorSpace = SRGBColorSpace
    const original = vi.spyOn(source, 'dispose')
    const mapped = prepareRgbCloudTextures(source, { maxWidth: 1 })
    const white = prepareRgbCloudTextures(source, { maxWidth: 1, color: { kind: 'constant', srgb: [1, 1, 1] } })
    expect(white.weather.image.data).toEqual(mapped.weather.image.data)
    expect(white.color).toBeNull()
    expect(white.constantColorLinear).toEqual([1, 1, 1])
    expect(white.colorStrength).toBe(1)
    const weather = vi.spyOn(white.weather, 'dispose')
    white.dispose()
    white.dispose()
    expect(weather).toHaveBeenCalledTimes(1)
    expect(original).not.toHaveBeenCalled()
    mapped.dispose()
    source.dispose()
  })
  it('converts constants once and gives explicit color precedence over legacy strength', () => {
    const source = texture([128], 1, 1)
    const constant = prepareRgbCloudTextures(source, {
      color: { kind: 'constant', srgb: [0.25, 0.5, 0.75] },
      colorStrength: 0.1
    })
    expect(constant.constantColorLinear).toEqual(new Color().setRGB(0.25, 0.5, 0.75, SRGBColorSpace).toArray())
    expect(constant.colorStrength).toBe(1)
    const mapped = prepareRgbCloudTextures(source, {
      color: { kind: 'map', map: { resourceId: 26 }, strength: 0.6 },
      colorStrength: 0.1
    })
    const legacy = prepareRgbCloudTextures(source, { colorStrength: 0.2 })
    expect((mapped.color as DataTexture).image.data).toEqual((legacy.color as DataTexture).image.data)
    expect(mapped.colorStrength).toBe(0.6)
    expect(legacy.colorStrength).toBe(0.2)
    constant.dispose()
    mapped.dispose()
    legacy.dispose()
    source.dispose()
  })
  it('decodes before reduction', () => {
    const source = texture([0, 255], 2, 1)
    source.colorSpace = SRGBColorSpace
    const maps = prepareRgbCloudTextures(source, { maxWidth: 1 })
    expect(maps.weather.image.width).toBe(1)
    expect((maps.weather.image.data as Uint8Array)[0] / 255).toBeCloseTo(0.5, 2)
    expect((maps.weather.image.data as Uint8Array)[0] / 255).not.toBeCloseTo(Math.SQRT1_2, 2)
    maps.dispose()
    source.dispose()
  })
  it('uses the RGB mean, handles black and converts sRGB exactly once', () => {
    expect(decodeRgbCloud([0, 0, 0], 'linear')).toEqual({ coverage: 0, albedo: [0, 0, 0] })
    expect(decodeRgbCloud([1, 0, 0], 'linear')).toEqual({ coverage: Math.sqrt(1 / 3), albedo: [1, 0, 0] })
    expect(decodeRgbCloud([0.5, 0.5, 0.5], 'linear').coverage).toBeCloseTo(Math.sqrt(0.5))
    expect(decodeRgbCloud([0.5, 0.5, 0.5], 'srgb').coverage).toBeCloseTo(0.4626458, 6)
    for (const value of [-1, 2, NaN, Infinity]) expect(() => decodeRgbCloud([value, 0, 0], 'linear')).toThrow()
  })
  it.each([false, true])('preserves asymmetric rows with flipY=%s', (flipY) => {
    const source = texture([0, 64, 255, 255, 64, 0], 3, 2)
    source.flipY = flipY
    const maps = prepareRgbCloudTextures(source)
    expect(Array.from(maps.weather.image.data as Uint8Array).filter((_, i) => i % 4 === 0)).toEqual(
      flipY ? [255, 128, 0, 0, 128, 255] : [0, 128, 255, 255, 128, 0]
    )
    expect(maps.weather.flipY).toBe(false)
    expect(maps.color!.colorSpace).toBe(NoColorSpace)
    maps.dispose()
    source.dispose()
  })
  it('uses fractional box areas for a 5 by 3 image', () => {
    const source = texture(
      Array.from({ length: 15 }, (_, i) => (i % 5 === 0 ? 255 : 0)),
      5,
      3
    )
    const maps = prepareRgbCloudTextures(source, { maxWidth: 2 })
    expect(maps.weather.image.height).toBe(1)
    expect(Array.from(maps.weather.image.data as Uint8Array)).toEqual([102, 0, 0, 0, 0, 0, 0, 0])
    maps.dispose()
    source.dispose()
  })
  it('owns only the derived maps and disposes them once', () => {
    const source = texture([64], 1, 1)
    const original = vi.spyOn(source, 'dispose')
    const before = [source.flipY, source.colorSpace, source.wrapS, source.matrix.clone()]
    const maps = prepareRgbCloudTextures(source)
    const weather = vi.spyOn(maps.weather, 'dispose')
    const color = vi.spyOn(maps.color!, 'dispose')
    maps.dispose()
    maps.dispose()
    expect(weather).toHaveBeenCalledTimes(1)
    expect(color).toHaveBeenCalledTimes(1)
    expect(original).not.toHaveBeenCalled()
    expect([source.flipY, source.colorSpace, source.wrapS, source.matrix]).toEqual(before)
    original.mockRestore()
    source.dispose()
  })
  it('rejects invalid bounds and unsupported sources', () => {
    const source = texture([0], 1, 1)
    for (const maxWidth of [0, -1, 1.5, NaN, Infinity])
      expect(() => prepareRgbCloudTextures(source, { maxWidth })).toThrow()
    expect(() => readCloudImagePixels(new Texture({ width: 1, height: 1 } as HTMLImageElement))).toThrow(/image/i)
    source.image.data = new Uint8Array(3)
    expect(() => readCloudImagePixels(source)).toThrow(/RGBA/i)
  })
  it('uses natural dimensions and diagnoses canvas failures', () => {
    const image = document.createElement('img')
    image.width = 1
    image.height = 1
    Object.defineProperties(image, {
      naturalWidth: { value: 5 },
      naturalHeight: { value: 3 },
      complete: { value: true }
    })
    const bytes = new Uint8ClampedArray(60)
    const drawImage = vi.fn()
    const getImageData = vi.fn(() => ({ data: bytes }))
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage, getImageData } as never)
    try {
      expect(readCloudImagePixels(new Texture(image))).toMatchObject({ width: 5, height: 3, bytes })
      expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 5, 3)
      getImageData.mockImplementation(() => {
        throw new Error('tainted canvas')
      })
      expect(() => readCloudImagePixels(new Texture(image))).toThrow(/tainted/)
      context.mockReturnValue(null)
      expect(() => readCloudImagePixels(new Texture(image))).toThrow(/context/i)
    } finally {
      context.mockRestore()
    }
  })
  it('prepares ordinary masks without appearance coverageRange', () => {
    const source = texture([64], 1, 1)
    const layer = createEarthCloudProfile().layers[0]
    layer.pattern = {
      kind: 'mask',
      map: { resourceId: 26 },
      decode: { channel: 'r', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'linear' }
    }
    const maps = prepareCloudAppearanceTextures(layer, () => source)
    expect((maps.weather.image.data as Uint8Array)[0]).toBe(64)
    maps.dispose()
    source.dispose()
  })
})
