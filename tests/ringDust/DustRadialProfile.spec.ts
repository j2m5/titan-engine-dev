import { ClampToEdgeWrapping, LinearFilter, RedFormat, UnsignedByteType } from 'three'
import {
  createDustRadialTexture,
  normalizeDustBins
} from '@/core/renderables/DetailedRingStreamingSystem/dust/DustRadialProfile'

describe('DustRadialProfile: нормировка профиля пыли', () => {
  it('среднее модуляции ≈ 1 — калибровка dustTauGrazing сохраняется', () => {
    const data = normalizeDustBins(new Float32Array([1, 0, 0.5, 0.5]))
    expect(data).not.toBeNull()

    const { bytes, scale } = data!
    expect(Array.from(bytes)).toEqual([255, 0, 128, 128])
    // mean(bytes/255 · scale) ≈ 1 (с точностью 8-битного квантования)
    const meanModulation = (Array.from(bytes).reduce((s, b) => s + b / 255, 0) / bytes.length) * scale
    expect(meanModulation).toBeCloseTo(1, 2)
  })

  it('концентрация: субкольцо получает модуляцию > 1, пустота — 0', () => {
    const { bytes, scale } = normalizeDustBins(new Float32Array([1, 0, 0, 0]))!
    expect((bytes[0] / 255) * scale).toBeCloseTo(4, 5) // вся пыль в четверти кольца
    expect(bytes[1]).toBe(0)
  })

  it('вырожденный профиль (полностью прозрачная текстура) → null', () => {
    expect(normalizeDustBins(new Float32Array([0, 0, 0]))).toBeNull()
  })

  it('текстура: R-канал, LinearFilter, clamp, без мипов', () => {
    const radial = createDustRadialTexture(new Float32Array([1, 0.2, 0.6]))
    expect(radial).not.toBeNull()

    const { texture, scale } = radial!
    expect(scale).toBeGreaterThan(0)
    expect(texture.image.width).toBe(3)
    expect(texture.image.height).toBe(1)
    expect(texture.format).toBe(RedFormat)
    expect(texture.type).toBe(UnsignedByteType)
    expect(texture.magFilter).toBe(LinearFilter)
    expect(texture.minFilter).toBe(LinearFilter)
    expect(texture.wrapS).toBe(ClampToEdgeWrapping)
    expect(texture.generateMipmaps).toBe(false)
    expect(texture.version).toBeGreaterThan(0) // needsUpdate выставлен (сеттер инкрементирует version)
  })
})
