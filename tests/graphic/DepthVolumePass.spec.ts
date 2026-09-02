import { vi } from 'vitest'
import { BasicDepthPacking, Color, DepthTexture, FloatType, Group, PerspectiveCamera, WebGLRenderTarget } from 'three'
import type { WebGLRenderer } from 'three'
import { DepthCopyPass } from 'postprocessing'
import { DepthVolumePass } from '@/core/graphic/passes/DepthVolumePass'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'

// Таргет копии глубины в типах библиотеки не объявлен, сцена — protected; в рантайме есть оба
const copyTargetOf = (pass: DepthVolumePass): WebGLRenderTarget =>
  (pass.depthCopy as unknown as { renderTarget: WebGLRenderTarget }).renderTarget
const copySceneOf = (pass: DepthVolumePass): unknown => (pass.depthCopy as unknown as { scene: unknown }).scene

const makeVolume = (registry: DepthVolumeRegistry) =>
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

describe('DepthVolumePass', () => {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1000)
  const inputBuffer = new WebGLRenderTarget(4, 4)
  const outputBuffer = new WebGLRenderTarget(4, 4)

  it('рисует в inputBuffer поверх сцены (без swap) и требует depth-текстуру', () => {
    const pass = new DepthVolumePass(camera, new DepthVolumeRegistry())
    expect(pass.needsSwap).toBe(false)
    expect(pass.needsDepthTexture).toBe(true)
  })

  it('копирует глубину во float-таргет: сэмплировать аттачмент рисуемого буфера нельзя', () => {
    const pass = new DepthVolumePass(camera, new DepthVolumeRegistry())
    expect(pass.depthCopy).toBeInstanceOf(DepthCopyPass)
    expect(pass.depthCopy.depthPacking).toBe(BasicDepthPacking)
    expect(pass.depthCopy.texture.type).toBe(FloatType)
  })

  it('прокидывает depth-текстуру композера и размер в копию глубины', () => {
    const pass = new DepthVolumePass(camera, new DepthVolumeRegistry())
    const depth = new DepthTexture(4, 4)
    pass.setDepthTexture(depth)
    expect((pass.depthCopy.fullscreenMaterial as unknown as { depthBuffer: unknown }).depthBuffer).toBe(depth)

    pass.setSize(800, 600)
    expect(copyTargetOf(pass).width).toBe(800)
    expect(copyTargetOf(pass).height).toBe(600)
  })

  it('без видимых объёмов не рендерит ничего — ни копию глубины, ни гало', () => {
    const registry = new DepthVolumeRegistry()
    const hidden = new Group()
    hidden.visible = false
    hidden.add(makeVolume(registry))
    const { renderer } = makeRenderer(camera)

    new DepthVolumePass(camera, registry).render(renderer, inputBuffer, outputBuffer)

    expect(renderer.render).not.toHaveBeenCalled()
    expect(renderer.setRenderTarget).not.toHaveBeenCalled()
  })

  it('сначала копия глубины, затем каждый видимый объём в inputBuffer на слое пыли', () => {
    const registry = new DepthVolumeRegistry()
    const a = makeVolume(registry)
    const b = makeVolume(registry)
    const hiddenParent = new Group()
    hiddenParent.visible = false
    hiddenParent.add(makeVolume(registry))
    const { renderer, log } = makeRenderer(camera)
    const pass = new DepthVolumePass(camera, registry)
    pass.setSize(800, 600)

    const maskBefore = camera.layers.mask
    pass.render(renderer, inputBuffer, outputBuffer)

    // Порядок: копия глубины (свой таргет) → объёмы (inputBuffer)
    expect(log.scenes).toEqual([copySceneOf(pass), a, b])
    expect(log.targets[0]).toBe(copyTargetOf(pass))
    expect(log.targets[1]).toBe(inputBuffer)
    expect(log.targets[2]).toBe(inputBuffer)
    // Объёмы рисуются с камерой на слое пыли, после — маска восстановлена
    expect(log.masks[1]).toBe(1 << DEPTH_VOLUME_LAYER)
    expect(log.masks[2]).toBe(1 << DEPTH_VOLUME_LAYER)
    expect(camera.layers.mask).toBe(maskBefore)
    // Теневые карты не пересчитываются вторым рендером
    expect(renderer.shadowMap.autoUpdate).toBe(true)
  })

  it('привязывает к каждому объёму копию глубины, разрешение и лог-фактор камеры', () => {
    const registry = new DepthVolumeRegistry()
    const volume = makeVolume(registry)
    const { renderer } = makeRenderer(camera)
    const pass = new DepthVolumePass(camera, registry)
    pass.setSize(800, 600)

    pass.render(renderer, inputBuffer, outputBuffer)

    const u = volume.dustMaterial.uniforms
    expect(u.uSceneDepth.value).toBe(pass.depthCopy.texture)
    expect(u.uResolution.value.x).toBe(800)
    expect(u.uResolution.value.y).toBe(600)
    expect(u.uLogFarFactor.value).toBeCloseTo(Math.log2(camera.far + 1), 12)
  })

  it('рисует объёмы от дальнего к ближнему: ближний ложится поверх дальнего', () => {
    const registry = new DepthVolumeRegistry()
    const near = makeVolume(registry)
    const far = makeVolume(registry)
    const mid = makeVolume(registry)
    near.position.set(0, 0, -10)
    far.position.set(0, 0, -1000)
    mid.position.set(0, 0, -100)
    for (const v of [near, far, mid]) v.updateMatrixWorld()
    const cam = new PerspectiveCamera(50, 1, 1e-6, 1000)
    const { renderer, log } = makeRenderer(cam)

    new DepthVolumePass(cam, registry).render(renderer, inputBuffer, outputBuffer)

    expect(log.scenes.slice(1)).toEqual([far, mid, near])
  })

  it('включает обрезку по глубине только на время своего рендера', () => {
    const registry = new DepthVolumeRegistry()
    const volume = makeVolume(registry)
    const enabledDuringRender: number[] = []
    const { renderer } = makeRenderer(camera)
    renderer.render.mockImplementation(() => {
      enabledDuringRender.push(volume.dustMaterial.uniforms.uSceneDepthEnabled.value)
    })

    new DepthVolumePass(camera, registry).render(renderer, inputBuffer, outputBuffer)

    // Первый render — копия глубины, второй — объём с включённой обрезкой
    expect(enabledDuringRender[1]).toBe(1)
    // После пасса обрезка снята: рендер объёма вне пасса (запекание импостора) идёт без неё
    expect(volume.dustMaterial.uniforms.uSceneDepthEnabled.value).toBe(0)
  })

  it('renderToScreen: объёмы уходят на экран, а не в inputBuffer', () => {
    const registry = new DepthVolumeRegistry()
    makeVolume(registry)
    const { renderer, log } = makeRenderer(camera)
    const pass = new DepthVolumePass(camera, registry)
    pass.renderToScreen = true

    pass.render(renderer, inputBuffer, outputBuffer)

    expect(log.targets[1]).toBeNull()
  })
})
