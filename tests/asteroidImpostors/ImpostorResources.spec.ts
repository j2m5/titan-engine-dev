import { NoColorSpace, type WebGLArrayRenderTarget, type WebGLRenderer } from 'three'
import { checkImpostorCapabilities, createImpostorAtlas, impostorScratchBytes } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorResources'
import { createImpostorLayout } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'

function rendererWithLimits(limits: number[] = [4096, 256, 16, 16, 16]) {
  const gl = {
    MAX_TEXTURE_SIZE: 0, MAX_ARRAY_TEXTURE_LAYERS: 1, MAX_VERTEX_ATTRIBS: 2,
    MAX_VARYING_VECTORS: 3, MAX_TEXTURE_IMAGE_UNITS: 4,
    RENDERBUFFER: 5, RGBA8: 6, DEPTH_COMPONENT24: 7, SAMPLES: 8,
    getParameter: (key: number) => limits[key],
    getInternalformatParameter: (_target: number, format: number) => new Int32Array(format === 6 ? [8, 4, 2] : [4, 2]),
    isContextLost: () => false
  }
  return { getContext: () => gl, initRenderTarget: vi.fn() } as unknown as WebGLRenderer
}

describe('ресурсы атласа', () => {
  const layout = createImpostorLayout(8, 64)

  it('учитывает multisample и resolve depth отдельно от цветовых буферов', () => {
    // Две RGBA8 цепочки страницы, mip-scratch, tile color/depth и треугольник.
    expect(impostorScratchBytes(layout, 4)).toBe(5_139_148)
    expect(impostorScratchBytes(layout, 0)).toBe(4_942_540)
  })

  it('ограничивает samples совместно по color и depth, а layers — по формам', () => {
    const result = checkImpostorCapabilities(rendererWithLimits(), layout, 14)
    expect(result).toEqual({ supported: true, reason: null, samples: 4 })
    expect(checkImpostorCapabilities(rendererWithLimits([4096, 14, 16, 16, 16]), layout, 14).supported).toBe(false)
    expect(checkImpostorCapabilities(rendererWithLimits([256, 256, 16, 16, 16]), layout, 14).supported).toBe(false)
    expect(checkImpostorCapabilities(rendererWithLimits(), layout, 65).supported).toBe(false)
  })

  it('готовит полную mip-цепочку, но не разрешает автоматическое смешивание кадров после записи', () => {
    const renderer = rendererWithLimits()
    const duringInit: boolean[] = []
    const disposed: WebGLArrayRenderTarget[] = []
    vi.mocked(renderer.initRenderTarget).mockImplementation(target => {
      duringInit.push(target.texture.generateMipmaps)
      target.addEventListener('dispose', () => disposed.push(target as WebGLArrayRenderTarget))
    })
    const atlas = createImpostorAtlas(renderer, layout, 14)
    expect(duringInit).toEqual([true, true])
    expect(atlas.layerCount).toBe(15)
    expect(atlas.normalDepth.image).toMatchObject({ width: 512, height: 512, depth: 15 })
    expect(atlas.normalDepth.generateMipmaps).toBe(false)
    expect(atlas.surfaceCoverage.generateMipmaps).toBe(false)
    expect(atlas.normalDepth.colorSpace).toBe(NoColorSpace)
    atlas.dispose()
    atlas.dispose()
    expect(disposed).toHaveLength(2)
  })

  it('снимает уже созданные цели, если следующая не инициализируется', () => {
    const renderer = rendererWithLimits()
    let disposals = 0
    let attempts = 0
    vi.mocked(renderer.initRenderTarget).mockImplementation(target => {
      target.addEventListener('dispose', () => disposals++)
      if (++attempts === 2) throw new Error('GPU allocation')
    })
    expect(() => createImpostorAtlas(renderer, layout, 14)).toThrow('GPU allocation')
    expect(disposals).toBe(2)
  })
})
