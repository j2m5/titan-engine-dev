import { describe, expect, it, vi } from 'vitest'
import { DataTexture, Texture, RGBAFormat, SRGBColorSpace, NoColorSpace } from 'three'
import { decodeRgbCloud } from '@/labs/earth-clouds/rgbCloudMap'
import { prepareRgbCloudTextures } from '@/labs/earth-clouds/earthCloudTextures'
import { readCloudImagePixels } from '@/labs/planet-clouds/cloudImagePixels'
import { prepareCloudAppearanceTextures } from '@/labs/jupiter-clouds/cloudAppearanceTextures'
import { createEarthCloudProfile } from '@/labs/earth-clouds/earthCloudProfile'

const texture = (values: number[], width: number, height: number) =>
  new DataTexture(new Uint8Array(values.flatMap((x) => [x, x, x, 255])), width, height, RGBAFormat)
describe('Earth RGB cloud preparation', () => {
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
      expect(readCloudImagePixels(new Texture(image), null)).toMatchObject({ width: 5, height: 3, bytes })
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
    const maps = prepareCloudAppearanceTextures(createEarthCloudProfile().layers[0], () => source)
    expect((maps.weather.image.data as Uint8Array)[0]).toBe(64)
    maps.dispose()
    source.dispose()
  })
})
