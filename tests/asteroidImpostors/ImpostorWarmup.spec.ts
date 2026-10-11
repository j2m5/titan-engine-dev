import { Color, type Scene, type ShaderMaterial, type WebGLRenderer } from 'three'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { createImpostorWarmup } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorWarmup'
import { resolveLightTint } from '@/core/helpers/lightSource'
import type { Actor } from '@/core/models/Actor'

vi.mock('@/core/helpers/lightSource', () => ({ resolveLightTint: vi.fn() }))

describe('Прогрев материалов импосторов', () => {
  it.each(Array.from({ length: 8 }, (_, i) => ({ ice: !!(i & 1), cascade: !!(i & 2), lightTint: !!(i & 4) })))(
  'использует тот же ключ программы, что видимый материал: %j', async variant => {
    vi.mocked(resolveLightTint).mockReturnValue({ active: variant.lightTint, color: new Color(1, 1, 1) })
    const rendered: ShaderMaterial[] = []
    const renderer = {
      debug: { onShaderError: null }, getContext: () => ({ NO_ERROR: 0, getError: () => 0, isContextLost: () => false }),
      getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
      getClearColor: (out: Color) => out.set(0), getClearAlpha: () => 1,
      getViewport: (out: unknown) => out, getScissor: (out: unknown) => out, getScissorTest: () => false,
      setRenderTarget: vi.fn(), setViewport: vi.fn(), setScissor: vi.fn(), setScissorTest: vi.fn(), setClearColor: vi.fn(),
      render: (scene: Scene) => {
        const mesh = scene.children.find(child => child.visible) as { material?: ShaderMaterial } | undefined
        rendered.push(mesh!.material!)
      }
    } as unknown as WebGLRenderer
    const warmup = createImpostorWarmup(renderer, variant)
    const near = new InstancedAsteroidMaterial({} as Actor, undefined, variant.ice)
    const far = new BillboardAsteroidMaterial({} as Actor, variant.cascade, variant.ice, true)
    try {
      await warmup.run()
      for (const [i, expected] of [near, far].entries()) {
        expect(rendered[i].vertexShader).toBe(expected.vertexShader)
        expect(rendered[i].fragmentShader).toBe(expected.fragmentShader)
        // three.js включает порядок defines в ключ программы.
        expect(Object.entries(rendered[i].defines)).toEqual(Object.entries(expected.defines))
      }
    } finally { warmup.dispose(); near.dispose(); far.dispose() }
  })
})
