import { vi } from 'vitest'
import { BasicDepthPacking, Color, DepthTexture, FloatType, Group, PerspectiveCamera, WebGLRenderTarget } from 'three'
import type { WebGLRenderer } from 'three'
import { DepthCopyPass } from 'postprocessing'
import { RingDustPass } from '@/core/graphic/passes/RingDustPass'
import { RingDustRegistry } from '@/core/services/RingDustRegistry'
import { RING_DUST_LAYER, RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'

// Таргет копии глубины в типах библиотеки не объявлен, сцена — protected; в рантайме есть оба
const copyTargetOf = (pass: RingDustPass): WebGLRenderTarget =>
  (pass.depthCopy as unknown as { renderTarget: WebGLRenderTarget }).renderTarget
const copySceneOf = (pass: RingDustPass): unknown => (pass.depthCopy as unknown as { scene: unknown }).scene

const makeVolume = (registry: RingDustRegistry) =>
  new RingDustVolume({
    innerRadius: 70,
    outerRadius: 140,
    dustScaleHeight: 0.5,
    dustDensity: 0.01,
    dustColor: new Color(0x9b968c),
    anglePower: 2,
    nearFade: 20,
    maxSteps: 16,
    planetRadius: 12,
    registry
  })

/**
 * Рендерер-заглушка: на каждый render запоминает, что рисовали, в какой таргет
 * и с какой маской слоёв камеры
 */
const makeRenderer = (camera: PerspectiveCamera) => {
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
  } as unknown as WebGLRenderer & { render: ReturnType<typeof vi.fn>; setRenderTarget: ReturnType<typeof vi.fn> }
  return { renderer, log }
}

describe('RingDustPass', () => {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1000)
  const inputBuffer = new WebGLRenderTarget(4, 4)
  const outputBuffer = new WebGLRenderTarget(4, 4)

  it('рисует в inputBuffer поверх сцены (без swap) и требует depth-текстуру', () => {
    const pass = new RingDustPass(camera, new RingDustRegistry())
    expect(pass.needsSwap).toBe(false)
    expect(pass.needsDepthTexture).toBe(true)
  })

  it('копирует глубину во float-таргет: сэмплировать аттачмент рисуемого буфера нельзя', () => {
    const pass = new RingDustPass(camera, new RingDustRegistry())
    expect(pass.depthCopy).toBeInstanceOf(DepthCopyPass)
    expect(pass.depthCopy.depthPacking).toBe(BasicDepthPacking)
    expect(pass.depthCopy.texture.type).toBe(FloatType)
  })

  it('прокидывает depth-текстуру композера и размер в копию глубины', () => {
    const pass = new RingDustPass(camera, new RingDustRegistry())
    const depth = new DepthTexture(4, 4)
    pass.setDepthTexture(depth)
    expect((pass.depthCopy.fullscreenMaterial as unknown as { depthBuffer: unknown }).depthBuffer).toBe(depth)

    pass.setSize(800, 600)
    expect(copyTargetOf(pass).width).toBe(800)
    expect(copyTargetOf(pass).height).toBe(600)
  })

  it('без видимых объёмов не рендерит ничего — ни копию глубины, ни гало', () => {
    const registry = new RingDustRegistry()
    const hidden = new Group()
    hidden.visible = false
    hidden.add(makeVolume(registry))
    const { renderer } = makeRenderer(camera)

    new RingDustPass(camera, registry).render(renderer, inputBuffer, outputBuffer)

    expect(renderer.render).not.toHaveBeenCalled()
    expect(renderer.setRenderTarget).not.toHaveBeenCalled()
  })

  it('сначала копия глубины, затем каждый видимый объём в inputBuffer на слое пыли', () => {
    const registry = new RingDustRegistry()
    const a = makeVolume(registry)
    const b = makeVolume(registry)
    const hiddenParent = new Group()
    hiddenParent.visible = false
    hiddenParent.add(makeVolume(registry))
    const { renderer, log } = makeRenderer(camera)
    const pass = new RingDustPass(camera, registry)
    pass.setSize(800, 600)

    const maskBefore = camera.layers.mask
    pass.render(renderer, inputBuffer, outputBuffer)

    // Порядок: копия глубины (свой таргет) → объёмы (inputBuffer)
    expect(log.scenes).toEqual([copySceneOf(pass), a, b])
    expect(log.targets[0]).toBe(copyTargetOf(pass))
    expect(log.targets[1]).toBe(inputBuffer)
    expect(log.targets[2]).toBe(inputBuffer)
    // Объёмы рисуются с камерой на слое пыли, после — маска восстановлена
    expect(log.masks[1]).toBe(1 << RING_DUST_LAYER)
    expect(log.masks[2]).toBe(1 << RING_DUST_LAYER)
    expect(camera.layers.mask).toBe(maskBefore)
    // Теневые карты не пересчитываются вторым рендером
    expect(renderer.shadowMap.autoUpdate).toBe(true)
  })

  it('привязывает к каждому объёму копию глубины, разрешение и лог-фактор камеры', () => {
    const registry = new RingDustRegistry()
    const volume = makeVolume(registry)
    const { renderer } = makeRenderer(camera)
    const pass = new RingDustPass(camera, registry)
    pass.setSize(800, 600)

    pass.render(renderer, inputBuffer, outputBuffer)

    const u = volume.dustMaterial.uniforms
    expect(u.uSceneDepth.value).toBe(pass.depthCopy.texture)
    expect(u.uResolution.value.x).toBe(800)
    expect(u.uResolution.value.y).toBe(600)
    expect(u.uLogFarFactor.value).toBeCloseTo(Math.log2(camera.far + 1), 12)
  })

  it('renderToScreen: объёмы уходят на экран, а не в inputBuffer', () => {
    const registry = new RingDustRegistry()
    makeVolume(registry)
    const { renderer, log } = makeRenderer(camera)
    const pass = new RingDustPass(camera, registry)
    pass.renderToScreen = true

    pass.render(renderer, inputBuffer, outputBuffer)

    expect(log.targets[1]).toBeNull()
  })
})
