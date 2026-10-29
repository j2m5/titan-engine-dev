import { describe, expect, it, vi } from 'vitest'
import { CloudsEffect } from '@takram/three-clouds'
import {
  HalfFloatType,
  Mesh,
  PerspectiveCamera,
  RGBAIntegerFormat,
  Scene,
  ShaderMaterial,
  UnsignedIntType,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { prepareCloudCurrentOutput } from '@/core/clouds/takram/prepareCloudCurrentOutput'

function fixture() {
  const effect = new CloudsEffect(new PerspectiveCamera())
  effect.lightShafts = false
  const pass = effect.cloudsPass.currentPass
  const material = effect.cloudsPass.currentMaterial
  const output = new WebGLRenderTarget(33, 17, { type: HalfFloatType, count: 2, depthBuffer: false })
  const draws: Array<{ target: WebGLRenderTarget; material: ShaderMaterial; size: number[] }> = []
  let target: WebGLRenderTarget
  const renderer = {
    setRenderTarget: (value: WebGLRenderTarget) => {
      target = value
    },
    render: (scene: Scene) => {
      const mesh = scene.children.find((object) => object instanceof Mesh) as Mesh
      draws.push({ target, material: mesh.material as ShaderMaterial, size: [target.width, target.height] })
    }
  } as unknown as WebGLRenderer
  return { effect, pass, material, output, draws, renderer }
}

describe('cloud current output packing', () => {
  it('runs the heavy kernel into one integer attachment and preserves the public half-float targets on resize', () => {
    const f = fixture()
    const binding = prepareCloudCurrentOutput(f.pass)
    try {
      f.pass.render(f.renderer, null, f.output)
      expect(f.draws).toHaveLength(2)
      const packed = f.draws[0].target
      expect(f.draws[0].material).toBe(f.material)
      expect(packed.textures).toHaveLength(1)
      expect(packed.texture.type).toBe(UnsignedIntType)
      expect(packed.texture.format).toBe(RGBAIntegerFormat)
      expect(f.draws[1].target).toBe(f.output)
      expect(f.draws[1].material).not.toBe(f.material)
      expect(f.draws.map((draw) => draw.size)).toEqual([
        [33, 17],
        [33, 17]
      ])
      f.output.setSize(65, 3)
      f.pass.render(f.renderer, null, f.output)
      expect(f.draws[2].target).toBe(packed)
      expect(f.draws.slice(2).map((draw) => draw.size)).toEqual([
        [65, 3],
        [65, 3]
      ])
      expect(f.output.textures.every((texture) => texture.type === HalfFloatType)).toBe(true)
    } finally {
      binding.dispose()
      f.effect.dispose()
      f.output.dispose()
    }
  })

  it('restores hooks and releases only its own target and material exactly once', () => {
    const f = fixture()
    const render = f.pass.render,
      compile = f.material.onBeforeCompile,
      key = f.material.customProgramCacheKey
    const source = f.material.fragmentShader
    const binding = prepareCloudCurrentOutput(f.pass)
    f.pass.render(f.renderer, null, f.output)
    const ownTarget = vi.fn(),
      ownMaterial = vi.fn(),
      borrowedTarget = vi.fn(),
      borrowedMaterial = vi.fn()
    f.draws[0].target.addEventListener('dispose', ownTarget)
    f.draws.at(-1)!.material.addEventListener('dispose', ownMaterial)
    f.output.addEventListener('dispose', borrowedTarget)
    f.material.addEventListener('dispose', borrowedMaterial)
    binding.dispose()
    binding.dispose()
    expect(ownTarget).toHaveBeenCalledOnce()
    expect(ownMaterial).toHaveBeenCalledOnce()
    expect(borrowedTarget).not.toHaveBeenCalled()
    expect(borrowedMaterial).not.toHaveBeenCalled()
    expect(f.pass.render).toBe(render)
    expect(f.material.onBeforeCompile).toBe(compile)
    expect(f.material.customProgramCacheKey).toBe(key)
    expect(f.material.fragmentShader).toBe(source)
    f.effect.dispose()
    f.output.dispose()
  })

  it('preserves earlier shader hooks and isolates packed and retry programs from ordinary output', () => {
    const f = fixture()
    f.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = '// earlier hook\n' + shader.fragmentShader
    }
    const ordinaryKey = f.material.customProgramCacheKey()
    const binding = prepareCloudCurrentOutput(f.pass, 'retry-3')
    const shader = { fragmentShader: f.material.fragmentShader }
    try {
      f.material.onBeforeCompile(shader as never, f.renderer)
      expect(shader.fragmentShader).toContain('// earlier hook')
      expect(shader.fragmentShader).toContain('out highp uvec4')
      expect(f.material.customProgramCacheKey()).not.toBe(ordinaryKey)
      const unpack = binding.warmupScene.children.find((object) => object instanceof Mesh) as Mesh
      expect((unpack.material as ShaderMaterial).customProgramCacheKey()).toContain('retry-3')
    } finally {
      binding.dispose()
      expect(f.material.customProgramCacheKey()).toBe(ordinaryKey)
      f.effect.dispose()
      f.output.dispose()
    }
  })

  it('rejects changed output contracts atomically and prevents duplicate ownership', () => {
    const f = fixture()
    const source = f.material.fragmentShader,
      render = f.pass.render,
      compile = f.material.onBeforeCompile
    f.material.fragmentShader = source.replace('layout(location = 1) out vec3 outputDepthVelocity;', '')
    expect(() => prepareCloudCurrentOutput(f.pass)).toThrow(/expected one replacement/)
    expect(f.pass.render).toBe(render)
    expect(f.material.onBeforeCompile).toBe(compile)
    f.material.fragmentShader = source
    f.effect.lightShafts = true
    expect(() => prepareCloudCurrentOutput(f.pass)).toThrow(/shadow length/i)
    f.effect.lightShafts = false
    const binding = prepareCloudCurrentOutput(f.pass)
    expect(() => prepareCloudCurrentOutput(f.pass)).toThrow(/already/)
    binding.dispose()
    const replacement = prepareCloudCurrentOutput(f.pass)
    replacement.dispose()
    f.effect.dispose()
    f.output.dispose()
  })
})
