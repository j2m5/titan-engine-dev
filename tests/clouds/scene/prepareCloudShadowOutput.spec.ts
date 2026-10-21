import { describe, expect, it, vi } from 'vitest'
import { CloudsEffect } from '@takram/three-clouds'
import {
  HalfFloatType,
  Mesh,
  PerspectiveCamera,
  RawShaderMaterial,
  Scene,
  UnsignedIntType,
  WebGLArrayRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { prepareCloudShadowOutput } from '@/core/clouds/takram/prepareCloudShadowOutput'

function fixture(attachmentLimit = 8) {
  const effect = new CloudsEffect(new PerspectiveCamera())
  const shadow = effect.shadowPass
  shadow.setSize(7, 5, 3)
  const current = new WebGLArrayRenderTarget(7, 5, 6)
  const resolved = new WebGLArrayRenderTarget(7, 5, 3)
  current.texture.type = resolved.texture.type = HalfFloatType
  const draws: Array<{
    target: WebGLRenderTarget
    layer: number
    material: RawShaderMaterial
    cascade?: number
    size: number[]
  }> = []
  let target: WebGLRenderTarget,
    layer = 0
  const gl = {
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER: 0x8d40,
    MAX_COLOR_ATTACHMENTS: 0x8cdf,
    getParameter: vi.fn(() => attachmentLimit),
    framebufferTextureLayer: (_target: number, attachment: number) => {
      if (attachment >= 0x8ce0 + attachmentLimit) throw new Error('Unsupported color attachment')
    },
    drawBuffers: (buffers: number[]) => expect(buffers).toEqual([0x8ce0])
  }
  const renderer = {
    setRenderTarget: (value: WebGLRenderTarget, face = 0) => {
      target = value
      layer = face
    },
    getContext: () => gl,
    render: (scene: Scene) => {
      const mesh = scene.children.find((object) => object instanceof Mesh) as Mesh
      const material = mesh.material as RawShaderMaterial
      draws.push({
        target,
        layer,
        material,
        cascade: material.uniforms.sceneCloudShadowCascade?.value,
        size: [target.width, target.height]
      })
    }
  } as unknown as WebGLRenderer
  const dispose = () => {
    effect.dispose()
    current.dispose()
    resolved.dispose()
  }
  return { effect, shadow, current, resolved, draws, renderer, gl, dispose }
}

describe('single-output shadow cascades', () => {
  it('can keep the original current pass and shader while splitting only temporal resolve', () => {
    const f = fixture(),
      current = f.shadow.currentMaterial
    const render = vi.fn()
    f.shadow.currentPass.render = render
    const hook = current.onBeforeCompile,
      key = current.customProgramCacheKey
    // The excluded shader is not owned or transformed by this binding.
    current.fragmentShader = 'untouched current shader'
    const binding = prepareCloudShadowOutput(f.shadow, undefined, { splitCurrent: false })
    try {
      expect(f.shadow.currentPass.render).toBe(render)
      expect(current.onBeforeCompile).toBe(hook)
      expect(current.customProgramCacheKey).toBe(key)
      expect(current.uniforms.sceneCloudShadowCascade).toBeUndefined()
      f.shadow.resolvePass.render(f.renderer, null, f.resolved)
      expect(f.draws.map((draw) => [draw.target === f.resolved, draw.layer])).toEqual([
        [true, 0],
        [true, 1],
        [true, 2]
      ])
    } finally {
      binding.dispose()
      f.dispose()
    }
  })
  it('renders six and eight array layers on a context with only four color attachments', () => {
    const f = fixture(4),
      binding = prepareCloudShadowOutput(f.shadow)
    try {
      f.shadow.currentPass.render(f.renderer, null, f.current)
      expect(f.draws.filter((draw) => draw.target === f.current).map((draw) => draw.layer)).toEqual([0, 3, 1, 4, 2, 5])
      f.shadow.setSize(7, 5, 4)
      f.current.setSize(7, 5, 8)
      f.draws.length = 0
      f.shadow.currentPass.render(f.renderer, null, f.current)
      expect(f.draws.filter((draw) => draw.target === f.current).map((draw) => draw.layer)).toEqual([
        0, 4, 1, 5, 2, 6, 3, 7
      ])
      expect(f.gl.getParameter).toHaveBeenCalledOnce()
      expect(f.gl.getParameter).toHaveBeenCalledWith(f.gl.MAX_COLOR_ATTACHMENTS)
    } finally {
      binding.dispose()
      f.dispose()
    }
  })
  it('keeps every color and velocity layer distinct and reuses its scratch target after resize', () => {
    const f = fixture(),
      ordinaryRender = f.shadow.currentPass.render
    const binding = prepareCloudShadowOutput(f.shadow)
    try {
      expect(f.shadow.currentPass.render).not.toBe(ordinaryRender)
      f.shadow.currentPass.render(f.renderer, null, f.current)
      const march = f.draws.filter((draw) => draw.material === f.shadow.currentMaterial)
      expect(march.map((draw) => draw.cascade)).toEqual([0, 1, 2])
      expect(march.every((draw) => draw.target === march[0].target)).toBe(true)
      expect(march[0].target.texture.type).toBe(UnsignedIntType)
      expect(march[0].target.textures).toHaveLength(1)
      expect(f.draws.filter((draw) => draw.target === f.current).map((draw) => draw.layer)).toEqual([0, 3, 1, 4, 2, 5])
      f.shadow.resolvePass.render(f.renderer, null, f.resolved)
      expect(f.draws.filter((draw) => draw.target === f.resolved).map((draw) => [draw.layer, draw.cascade])).toEqual([
        [0, 0],
        [1, 1],
        [2, 2]
      ])
      f.shadow.setSize(13, 9, 2)
      f.current.setSize(13, 9, 4)
      f.draws.length = 0
      f.shadow.currentPass.render(f.renderer, null, f.current)
      expect(f.draws[0].target).toBe(march[0].target)
      expect(f.draws[0].size).toEqual([13, 9])
      expect(f.draws.filter((draw) => draw.target === f.current).map((draw) => draw.layer)).toEqual([0, 2, 1, 3])
    } finally {
      binding.dispose()
      f.dispose()
    }
  })

  it('restores borrowed hooks and disposes only its own GPU resources once', () => {
    const f = fixture()
    const materials = [f.shadow.currentMaterial, f.shadow.resolveMaterial]
    const hooks = materials.map((material) => [
      material.onBeforeCompile,
      material.customProgramCacheKey,
      material.fragmentShader
    ])
    const renders = [f.shadow.currentPass.render, f.shadow.resolvePass.render]
    const borrowed = vi.fn()
    for (const owner of [...materials, f.current, f.resolved]) owner.addEventListener('dispose', borrowed)
    const binding = prepareCloudShadowOutput(f.shadow)
    try {
      expect(f.shadow.currentPass.render).not.toBe(renders[0])
      f.shadow.currentPass.render(f.renderer, null, f.current)
      const targetDisposed = vi.fn(),
        materialDisposed = vi.fn()
      f.draws[0].target.addEventListener('dispose', targetDisposed)
      f.draws[1].material.addEventListener('dispose', materialDisposed)
      binding.dispose()
      binding.dispose()
      expect(targetDisposed).toHaveBeenCalledOnce()
      expect(materialDisposed).toHaveBeenCalledOnce()
      expect(borrowed).not.toHaveBeenCalled()
      expect(f.shadow.currentPass.render).toBe(renders[0])
      expect(f.shadow.resolvePass.render).toBe(renders[1])
      materials.forEach((material, i) => {
        expect([material.onBeforeCompile, material.customProgramCacheKey, material.fragmentShader]).toEqual(hooks[i])
        expect(material.uniforms.sceneCloudShadowCascade).toBeUndefined()
      })
    } finally {
      binding.dispose()
      f.dispose()
    }
  })

  it('preserves prior compile hooks and separates retry programs without changing authored shader sources', () => {
    const f = fixture(),
      material = f.shadow.currentMaterial
    material.onBeforeCompile = (shader) => {
      shader.vertexShader += '\n// prior hook'
    }
    const source = material.fragmentShader,
      key = material.customProgramCacheKey()
    const binding = prepareCloudShadowOutput(f.shadow, 'retry-4')
    try {
      expect(material.customProgramCacheKey()).not.toBe(key)
      const shader = { fragmentShader: source, vertexShader: material.vertexShader }
      material.onBeforeCompile(shader as never, f.renderer)
      expect(shader.vertexShader).toContain('// prior hook')
      expect(material.fragmentShader).toBe(source)
      const unpack = binding.warmupScene.children.find((object) => object instanceof Mesh) as Mesh
      expect((unpack.material as RawShaderMaterial).customProgramCacheKey()).toContain('retry-4')
    } finally {
      binding.dispose()
      f.dispose()
    }
  })

  it('rejects either changed shader contract before installing hooks and rejects duplicate ownership', () => {
    const f = fixture(),
      material = f.shadow.resolveMaterial
    const source = material.fragmentShader,
      currentHook = f.shadow.currentMaterial.onBeforeCompile
    material.fragmentShader = source.replace('void main() {', 'void changed() {')
    try {
      expect(() => prepareCloudShadowOutput(f.shadow)).toThrow(/expected one replacement/)
      expect(f.shadow.currentMaterial.onBeforeCompile).toBe(currentHook)
      expect(f.shadow.currentMaterial.uniforms.sceneCloudShadowCascade).toBeUndefined()
      material.fragmentShader = source
      const binding = prepareCloudShadowOutput(f.shadow)
      try {
        expect(() => prepareCloudShadowOutput(f.shadow)).toThrow(/already/)
      } finally {
        binding.dispose()
      }
      const next = prepareCloudShadowOutput(f.shadow)
      next.dispose()
    } finally {
      f.dispose()
    }
  })
})
