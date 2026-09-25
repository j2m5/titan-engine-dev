import { describe, it, expect, vi } from 'vitest'
import { BasicDepthPacking, DepthTexture, FloatType, HalfFloatType, PerspectiveCamera, WebGLRenderTarget } from 'three'
import type { WebGLRenderer } from 'three'
import { CopyPass, DepthCopyPass } from 'postprocessing'
import { BlackHolePass } from '@/core/graphic/passes/BlackHolePass'
import { BLACK_HOLE_LAYER } from '@/core/graphic/passes/DepthVolume'
import { LensRegistry } from '@/core/services/LensRegistry'
import { BlackHole } from '@/core/renderables/BlackHole/BlackHole'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { Actor } from '@/core/models/Actor'

function stubActor(): Actor {
  return {
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'mass' ? 8.54e36 : def)
    },
    renderingObject: null,
    getAttribute: (key: string, def?: unknown): unknown => (key === 'name' ? 'Sagittarius A*' : def)
  } as unknown as Actor
}

const observer = { sceneBackground: null } as unknown as ResourceObserver

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
  } as unknown as WebGLRenderer & { render: ReturnType<typeof vi.fn> }
  return { renderer, log }
}

describe('BlackHolePass', () => {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1000)
  const inputBuffer = new WebGLRenderTarget(4, 4)
  const outputBuffer = new WebGLRenderTarget(4, 4)

  it('рисует в inputBuffer без swap, требует depth-текстуру; копии — глубина float, цвет half-float', () => {
    const pass = new BlackHolePass(camera, new LensRegistry())

    expect(pass.needsSwap).toBe(false)
    expect(pass.needsDepthTexture).toBe(true)
    expect(pass.depthCopy).toBeInstanceOf(DepthCopyPass)
    expect(pass.depthCopy.depthPacking).toBe(BasicDepthPacking)
    expect(pass.depthCopy.texture.type).toBe(FloatType)
    expect(pass.colorCopy).toBeInstanceOf(CopyPass)
    expect(pass.colorCopy.texture.type).toBe(HalfFloatType)
  })

  it('прокидывает depth-текстуру композера и размер в обе копии', () => {
    const pass = new BlackHolePass(camera, new LensRegistry())
    const depth = new DepthTexture(4, 4)
    pass.setDepthTexture(depth)
    expect((pass.depthCopy.fullscreenMaterial as unknown as { depthBuffer: unknown }).depthBuffer).toBe(depth)

    pass.setSize(640, 360)
    const colorTarget = (pass.colorCopy as unknown as { renderTarget: WebGLRenderTarget }).renderTarget
    expect(colorTarget.width).toBe(640)
    expect(colorTarget.height).toBe(360)
  })

  it('без видимой дыры не рендерит ничего: ни копий, ни меша', () => {
    const registry = new LensRegistry()
    const hole = new BlackHole(stubActor(), observer, registry)
    hole.visible = false
    const pass = new BlackHolePass(camera, registry)
    const { renderer, log } = makeRenderer(camera)
    const depthSpy = vi.spyOn(pass.depthCopy, 'render').mockImplementation(() => {})
    const colorSpy = vi.spyOn(pass.colorCopy, 'render').mockImplementation(() => {})

    pass.render(renderer, inputBuffer, outputBuffer)

    expect(depthSpy).not.toHaveBeenCalled()
    expect(colorSpy).not.toHaveBeenCalled()
    expect(log.scenes).toHaveLength(0)
  })

  it('видимый меш: обе копии, слой BLACK_HOLE_LAYER на время рендера, кадр привязан и отвязан, маска восстановлена', () => {
    const registry = new LensRegistry()
    const hole = new BlackHole(stubActor(), observer, registry)
    const pass = new BlackHolePass(camera, registry)
    const { renderer, log } = makeRenderer(camera)
    vi.spyOn(pass.depthCopy, 'render').mockImplementation(() => {})
    vi.spyOn(pass.colorCopy, 'render').mockImplementation(() => {})
    const bind = vi.spyOn(hole, 'bindSceneFrame')
    const unbind = vi.spyOn(hole, 'unbindSceneFrame')
    const maskBefore = camera.layers.mask

    pass.setSize(640, 360)
    pass.render(renderer, inputBuffer, outputBuffer)

    expect(log.scenes).toEqual([hole])
    expect(log.masks).toEqual([1 << BLACK_HOLE_LAYER])
    expect(log.targets).toEqual([inputBuffer])
    expect(bind).toHaveBeenCalledWith(pass.colorCopy.texture, pass.depthCopy.texture, expect.anything(), Math.log2(camera.far + 1))
    expect(unbind).toHaveBeenCalledOnce()
    expect(camera.layers.mask).toBe(maskBefore)
    expect(hole.layers.mask).toBe(1 << BLACK_HOLE_LAYER)
  })
})
