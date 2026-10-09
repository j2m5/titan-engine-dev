import { describe, expect, it, vi } from 'vitest'
import { AlwaysDepth, DepthTexture, Object3D, PerspectiveCamera, Scene, WebGLRenderTarget } from 'three'
import type { WebGLRenderer } from 'three'
import { DepthRestoreMaterial } from '@/core/graphic/passes/DepthRestoreMaterial'
import { LensFrontSplitPass } from '@/core/graphic/passes/LensFrontSplitPass'
import { LensFrontPass } from '@/core/graphic/passes/LensFrontPass'
import { LENS_FRONT_LAYER, DEPTH_VOLUME_LAYER, type DepthVolume } from '@/core/graphic/passes/DepthVolume'
import type { LensFrontSorter } from '@/core/graphic/passes/LensFrontSorter'

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

function sorterStub(objects: Object3D[] = [], volumes: DepthVolume[] = []) {
  return {
    split: vi.fn(),
    restore: vi.fn(),
    frontObjects: () => objects,
    frontVolumes: () => volumes,
    isFrontVolume: (v: DepthVolume) => volumes.includes(v)
  }
}

const internalSceneOf = (pass: LensFrontPass): unknown => (pass as unknown as { scene: unknown }).scene
const copySceneOf = (pass: LensFrontPass): unknown => (pass.depthCopy as unknown as { scene: unknown }).scene

describe('DepthRestoreMaterial: глубина сцены обратно в текущий буфер', () => {
  it('пишет только глубину, без теста по старой', () => {
    const material = new DepthRestoreMaterial()

    expect(material.fragmentShader).toContain('gl_FragDepth = texture(depthBuffer, vUv).r;')
    expect(material.colorWrite).toBe(false)
    expect(material.depthWrite).toBe(true)
    expect(material.depthTest).toBe(true)
    expect(material.depthFunc).toBe(AlwaysDepth)
  })
})

describe('LensFrontSplitPass: разметка до основного прохода', () => {
  it('зовёт split и ничего не рисует', () => {
    const sorter = sorterStub()
    const pass = new LensFrontSplitPass(sorter as unknown as LensFrontSorter)
    const { renderer } = makeRenderer(new PerspectiveCamera())

    expect(pass.needsSwap).toBe(false)
    pass.render(renderer, new WebGLRenderTarget(4, 4), new WebGLRenderTarget(4, 4))

    expect(sorter.split).toHaveBeenCalledTimes(1)
    expect(renderer.render).not.toHaveBeenCalled()
  })
})

describe('LensFrontPass: прозрачное перед линзой поверх лензированного кадра', () => {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1000)
  const scene = new Scene()
  const inputBuffer = new WebGLRenderTarget(4, 4)
  const outputBuffer = new WebGLRenderTarget(4, 4)

  it('рисует в inputBuffer без swap, глубину сцены берёт у композера', () => {
    const pass = new LensFrontPass(scene, camera, sorterStub() as unknown as LensFrontSorter)
    const depth = new DepthTexture(4, 4)
    pass.setDepthTexture(depth)

    expect(pass.needsSwap).toBe(false)
    expect(pass.needsDepthTexture).toBe(true)
    expect(pass.restoreMaterial.depthBuffer).toBe(depth)
  })

  it('пустая разметка — ни одного рендера, слои возвращены', () => {
    const sorter = sorterStub()
    const pass = new LensFrontPass(scene, camera, sorter as unknown as LensFrontSorter)
    pass.setDepthTexture(new DepthTexture(4, 4))
    const { renderer } = makeRenderer(camera)

    pass.render(renderer, inputBuffer, outputBuffer)

    expect(renderer.render).not.toHaveBeenCalled()
    expect(sorter.restore).toHaveBeenCalledTimes(1)
  })

  it('сначала возврат глубины, затем сцена на слое 27; маска, тени и слои возвращены', () => {
    const sorter = sorterStub([new Object3D()])
    const pass = new LensFrontPass(scene, camera, sorter as unknown as LensFrontSorter)
    pass.setDepthTexture(new DepthTexture(4, 4))
    const { renderer, log } = makeRenderer(camera)
    const maskBefore = camera.layers.mask

    pass.render(renderer, inputBuffer, outputBuffer)

    expect(log.scenes).toEqual([internalSceneOf(pass), scene])
    expect(log.targets).toEqual([inputBuffer, inputBuffer])
    expect(log.masks[1]).toBe(1 << LENS_FRONT_LAYER)
    expect(camera.layers.mask).toBe(maskBefore)
    expect((renderer.shadowMap as { autoUpdate: boolean }).autoUpdate).toBe(true)
    expect(sorter.restore).toHaveBeenCalledTimes(1)
  })

  it('буфер уже несёт глубину сцены (свопа не было) — возврат пропускается, иначе feedback loop', () => {
    const sorter = sorterStub([new Object3D()])
    const pass = new LensFrontPass(scene, camera, sorter as unknown as LensFrontSorter)
    const depth = new DepthTexture(4, 4)
    pass.setDepthTexture(depth)
    const attached = new WebGLRenderTarget(4, 4)
    attached.depthTexture = depth
    const { renderer, log } = makeRenderer(camera)

    pass.render(renderer, attached, outputBuffer)

    expect(log.scenes).toEqual([scene])
  })

  it('передние объёмы — после объектов: копия глубины, затем объём на слое объёмов с привязанной копией', () => {
    const bind = vi.fn()
    const volume = Object.assign(new Object3D(), { bindSceneDepth: bind, unbindSceneDepth: vi.fn() }) as unknown as DepthVolume
    const sorter = sorterStub([], [volume])
    const pass = new LensFrontPass(scene, camera, sorter as unknown as LensFrontSorter)
    pass.setDepthTexture(new DepthTexture(4, 4))
    pass.setSize(800, 600)
    const { renderer, log } = makeRenderer(camera)

    pass.render(renderer, inputBuffer, outputBuffer)

    expect(log.scenes).toEqual([internalSceneOf(pass), copySceneOf(pass), volume])
    expect(log.masks[2]).toBe(1 << DEPTH_VOLUME_LAYER)
    expect(bind.mock.calls[0][0]).toBe(pass.depthCopy.texture)
    expect(sorter.restore).toHaveBeenCalledTimes(1)
  })
})
