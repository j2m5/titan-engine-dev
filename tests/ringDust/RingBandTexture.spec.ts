import { RGBAFormat, UnsignedByteType } from 'three'
import { createRingBandTexture } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingBandTexture'

describe('createRingBandTexture: 1D-текстура полос кольца', () => {
  it('RGBA по бинам: цвет в RGB, альфа в A, LinearFilter/clamp', () => {
    const result = createRingBandTexture(new Float32Array([1, 0.5, 0, 0, 0, 1]), new Float32Array([1, 0.25]))!
    expect(result).not.toBeNull()
    const tex = result.texture
    expect(tex.image.width).toBe(2)
    expect(tex.image.height).toBe(1)
    expect(tex.format).toBe(RGBAFormat)
    expect(tex.type).toBe(UnsignedByteType)
    const bytes = tex.image.data as Uint8Array
    expect(Array.from(bytes.slice(0, 4))).toEqual([255, 128, 0, 255])
    expect(Array.from(bytes.slice(4, 8))).toEqual([0, 0, 255, 64])
    expect(tex.generateMipmaps).toBe(false)
  })

  it('средний цвет взвешен по альфе — пустоты не красят кольцо', () => {
    const result = createRingBandTexture(new Float32Array([1, 0, 0, 0, 1, 0]), new Float32Array([1, 0]))!
    expect(result.meanColor).toEqual([1, 0, 0])
  })

  it('полностью прозрачное кольцо — null', () => {
    expect(createRingBandTexture(new Float32Array([1, 1, 1]), new Float32Array([0]))).toBeNull()
  })

  it('несогласованные длины — null', () => {
    expect(createRingBandTexture(new Float32Array([1, 1, 1, 1]), new Float32Array([1]))).toBeNull()
  })
})
