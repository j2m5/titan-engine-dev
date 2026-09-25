import { describe, it, expect, vi } from 'vitest'
import { PerspectiveCamera, Scene, WebGLRenderTarget } from 'three'
import type { WebGLRenderer } from 'three'
import { OverlayPass } from '@/core/graphic/passes/OverlayPass'
import { OVERLAY_LAYER } from '@/core/graphic/passes/DepthVolume'
import { OrbitLine } from '@/core/renderables/utils/OrbitLine'
import { Actor } from '@/core/models/Actor'

/** Рендерер-заглушка: запоминает, что рисовали, куда и с какой маской слоёв */
function makeRenderer(camera: PerspectiveCamera) {
  const log = { current: null as unknown, targets: [] as unknown[], masks: [] as number[], scenes: [] as unknown[] }
  const renderer = {
    shadowMap: { autoUpdate: true },
    setRenderTarget: vi.fn((target: unknown) => {
      log.current = target
    }),
    render: vi.fn((scene: unknown) => {
      log.scenes.push(scene)
      log.masks.push(camera.layers.mask)
      log.targets.push(log.current)
    })
  } as unknown as WebGLRenderer
  return { renderer, log }
}

describe('OverlayPass: оверлеи поверх лензированного кадра', () => {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1000)
  const scene = new Scene()
  const inputBuffer = new WebGLRenderTarget(4, 4)
  const outputBuffer = new WebGLRenderTarget(4, 4)

  it('рисует сцену с маской OVERLAY_LAYER в inputBuffer без swap и восстанавливает маску камеры', () => {
    const pass = new OverlayPass(scene, camera)
    const { renderer, log } = makeRenderer(camera)
    const maskBefore = camera.layers.mask

    expect(pass.needsSwap).toBe(false)
    pass.render(renderer, inputBuffer, outputBuffer)

    expect(log.scenes).toEqual([scene])
    expect(log.masks).toEqual([1 << OVERLAY_LAYER])
    expect(log.targets).toEqual([inputBuffer])
    expect(camera.layers.mask).toBe(maskBefore)
    expect((renderer.shadowMap as { autoUpdate: boolean }).autoUpdate).toBe(true)
  })

  it('линия орбиты живёт на слое оверлеев: основной проход и копия кадра её не видят', () => {
    const actor = {
      orbit: null,
      getAttribute: (key: string, def?: unknown): unknown => (key === 'name' ? 'X' : key === 'color' ? '#ffffff' : def)
    } as unknown as Actor
    const line = new OrbitLine(actor)

    expect(line.layers.mask).toBe(1 << OVERLAY_LAYER)
    expect(line.material.depthTest).toBe(false)
  })
})
