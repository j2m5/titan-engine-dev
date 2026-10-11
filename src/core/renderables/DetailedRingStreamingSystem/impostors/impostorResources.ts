import { ClampToEdgeWrapping, LinearFilter, LinearMipmapNearestFilter, NearestFilter, NoColorSpace, RGBAFormat, UnsignedByteType, WebGLArrayRenderTarget, WebGLRenderTarget, type WebGLRenderer } from 'three'
import { IMPOSTOR_SLOT_CAPACITY, type ImpostorLayout } from './impostorLayout'
import type { ImpostorAtlas } from './impostorTypes'
import { textureBytes } from './impostorBudget'
import { forgetImpostorContext, rememberImpostorContext } from './impostorContext'

export interface ImpostorCapabilities {
  supported: boolean
  reason: string | null
  samples: number
}

export function checkImpostorCapabilities(renderer: WebGLRenderer, layout: ImpostorLayout, count: number): ImpostorCapabilities {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const failed = (reason: string): ImpostorCapabilities => ({ supported: false, reason, samples: 0 })
  if (gl.isContextLost()) return failed('Контекст WebGL потерян')
  if (!Number.isSafeInteger(count) || count < 1) return failed('Неверное число архетипов')
  if (count > IMPOSTOR_SLOT_CAPACITY) return failed('Лимит таблицы архетипов')
  const limits: [number, number, string][] = [
    [gl.MAX_TEXTURE_SIZE, layout.pageSize, 'размер текстуры'],
    [gl.MAX_ARRAY_TEXTURE_LAYERS, count + 1, 'число слоёв'],
    [gl.MAX_VERTEX_ATTRIBS, 13, 'атрибуты вершин'],
    [gl.MAX_VARYING_VECTORS, 16, 'varying-векторы'],
    [gl.MAX_TEXTURE_IMAGE_UNITS, 8, 'sampler-фрагменты']
  ]
  for (const [key, required, name] of limits) {
    const available = Number(gl.getParameter(key))
    if (!Number.isFinite(available) || available < required) return failed(`Лимит WebGL: ${name}`)
  }
  const color: Int32Array = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES)
  const depth: Int32Array = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES)
  const samples = Math.max(0, ...Array.from(color).filter(n => n <= 4 && depth.includes(n)))
  return { supported: true, reason: null, samples }
}

export function createImpostorAtlas(renderer: WebGLRenderer, layout: ImpostorLayout, count: number): ImpostorAtlas {
  const targets: WebGLArrayRenderTarget[] = []
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const target of targets) target.dispose()
  }
  try {
    for (let i = 0; i < 2; i++) {
      const target = new WebGLArrayRenderTarget(layout.pageSize, layout.pageSize, count + 1, {
        format: RGBAFormat, type: UnsignedByteType, internalFormat: 'RGBA8',
        minFilter: LinearMipmapNearestFilter, magFilter: LinearFilter,
        wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
        colorSpace: NoColorSpace, generateMipmaps: true, depthBuffer: false, stencilBuffer: false
      })
      targets.push(target)
      rememberImpostorContext(target, ...target.textures)
      renderer.initRenderTarget(target)
      // Полная цепочка уже выделена; дальше уровни пишутся вручную.
      target.texture.generateMipmaps = false
    }
    return { normalDepth: targets[0].texture, surfaceCoverage: targets[1].texture, layout, layerCount: count + 1, dispose,
      invalidateGpu: () => forgetImpostorContext(...targets, ...targets.flatMap(target => target.textures)) }
  } catch (error) {
    dispose()
    throw error
  }
}

export function impostorScratchBytes(layout: ImpostorLayout, samples: number): number {
  const tileColor = layout.frameSize ** 2 * 8 * (samples > 0 ? samples + 1 : 1)
  const tileDepth = layout.frameSize ** 2 * 4 * (samples > 0 ? samples + 1 : 1)
  return tileColor + tileDepth + textureBytes(layout.pageSize, layout.pageSize, 1, layout.mipCount, 8)
    + layout.pageSize ** 2 * 8 + 9 * 4
}

export function createImpostorScratch(renderer: WebGLRenderer, layout: ImpostorLayout, samples: number) {
  const targets: WebGLRenderTarget[] = []
  const create = (size: number, depth: boolean, mips = false, msaa = 0): WebGLRenderTarget => {
    const target = new WebGLRenderTarget(size, size, {
      count: 2, samples: msaa, depthBuffer: depth, stencilBuffer: false,
      format: RGBAFormat, type: UnsignedByteType, internalFormat: 'RGBA8',
      minFilter: mips ? LinearMipmapNearestFilter : NearestFilter, magFilter: NearestFilter,
      colorSpace: NoColorSpace, generateMipmaps: mips
    })
    targets.push(target)
    rememberImpostorContext(target, ...target.textures)
    renderer.initRenderTarget(target)
    for (const texture of target.textures) texture.generateMipmaps = false
    return target
  }
  try {
    const tile = create(layout.frameSize, true, false, samples)
    const staging = create(layout.pageSize, false, true)
    const mip = create(layout.pageSize, false)
    let disposed = false
    return { tile, staging, mip, invalidateGpu: () => forgetImpostorContext(...targets, ...targets.flatMap(target => target.textures)), dispose() {
      if (disposed) return
      disposed = true
      for (const target of targets) target.dispose()
    } }
  } catch (error) {
    for (const target of targets) target.dispose()
    throw error
  }
}
