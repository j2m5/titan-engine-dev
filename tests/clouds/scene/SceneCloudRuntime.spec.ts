import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Color,
  Data3DTexture,
  DataTexture,
  Object3D,
  PerspectiveCamera,
  ShaderMaterial,
  Texture,
  Vector2,
  WebGLRenderTarget
} from 'three'
import { SceneCloudRuntime } from '@/core/clouds/SceneCloudRuntime'
import { CloudRegistry, type CloudBodyEntry } from '@/core/services/CloudRegistry'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import type { SceneCloudOutput } from '@/core/clouds/takram/SceneCloudBackend'
import type { AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import type { AtmosphereFrameSnapshot } from '@/core/graphic/effects/atmosphere/atmosphereFrame'
import { SpaceScale } from '@/core/constants'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
const size = new Vector2(16, 8)
function fixture(pending = false) {
  const registry = new CloudRegistry(),
    object = new Object3D()
  object.position.x = 100 * SpaceScale
  const config = createEarthCloudProfile()
  const body: CloudBodyEntry = {
    actorId: 7,
    object,
    getSurface: () => object,
    datumRadiusMeters: 6371000,
    descriptor: {
      state: 'configured',
      volume: config,
      far: { pattern: config.layers[0].pattern as never, mapping: config.mapping, color: config.layers[0].color },
      qualityProfile: 'terrestrial',
      issues: []
    },
    resourcePaths: new Map([[26, 'runtime-test']]),
    lightColor: new Color(),
    lambert: 1
  }
  registry.register(body)
  const source = new DataTexture(new Uint8Array([64, 64, 64, 255]), 1, 1)
  source.name = 'runtime-test'
  resourceStorage.addTexture(source)
  const owner = new ShaderMaterial(),
    near = new ShaderMaterial()
  const receiver = {
    setFarMap: vi.fn(),
    setEndpoint: vi.fn(),
    dispose: vi.fn(),
    retryEndpointMaterial: vi.fn(),
    getEndpointMaterial: vi.fn((endpoint: 'far' | 'near') => (endpoint === 'far' ? owner : near))
  }
  registry.bindReceiver(7, receiver)
  const camera = new PerspectiveCamera(50, 2, 1e-6, 1e6)
  camera.position.copy(object.position)
  camera.position.z = ((6371000 + 5000) * SpaceScale) / 1000
  camera.updateMatrixWorld()
  const entry = {
    actorId: 8,
    bodyActorId: 7,
    generation: 1,
    ready: true,
    config: { bottomRadius: 6360 },
    lut: {}
  } as AtmosphereEntry
  let serial = 0
  const snapshot = (): AtmosphereFrameSnapshot => ({
    serial: ++serial,
    slots: [
      {
        entry,
        index: 0,
        generation: entry.generation,
        centerKm: camera.position.clone(),
        sunDirection: camera.position.clone()
      }
    ],
    dropped: []
  })
  let complete!: (value: ReturnType<typeof prepareCloudSource>) => void
  const prepared = prepareCloudSource(config, () => source)
  const prepare = vi.fn(() =>
    pending
      ? new Promise<ReturnType<typeof prepareCloudSource>>((resolve) => {
          complete = resolve
        })
      : prepared
  )
  const counts = { cloudUpdates: 0, shadowUpdates: 0 }
  const backend = {
    get updateCounts() {
      return counts
    },
    render: vi.fn((_r: unknown, _i: unknown, frame: CloudFrame) => {
      counts.cloudUpdates++
      counts.shadowUpdates++
      return {
        frame,
        atmosphereActorId: 8,
        atmosphereGeneration: 1,
        atmosphereBottomRadiusMeters: 6360000,
        historyGeneration: 0,
        overlay: new Texture(),
        shadow: null,
        stbn: new Data3DTexture()
      } as SceneCloudOutput
    }),
    resetHistory: vi.fn(),
    setSize: vi.fn(),
    dispose: vi.fn()
  }
  const createBackend = vi.fn(() => backend),
    runtime = new SceneCloudRuntime(registry, { prepare, createBackend })
  const begin = (lens = false) => {
    const atmo = snapshot()
    return runtime.beginFrame(camera, size, atmo.serial, 0.016, atmo, lens, 0)
  }
  return {
    registry,
    body,
    camera,
    entry,
    receiver,
    runtime,
    begin,
    backend,
    prepare,
    createBackend,
    prepared,
    complete: () => complete(prepared)
  }
}
afterEach(() => resourceStorage.deleteAllTextures())
describe('scene cloud runtime', () => {
  it('keeps the original backend cause when the enclosing compilation scope adds fatal evidence', () => {
    const f = fixture(),
      cause = Error('original backend render cause')
    f.begin()
    f.runtime.invalidate('error', cause)
    f.runtime.invalidate('error', Error('outer observed compilation'), { stage: 'backend', recovery: 'context' })
    expect(f.runtime.error).toBe(cause)
    f.runtime.dispose()
  })
  it.each(['depth', 'near'] as const)(
    'does not clear context-only %s shader failure through options, layout, source or scenario',
    (stage) => {
      const f = fixture()
      f.begin()
      const cause = Error('unknown receiver failure')
      f.runtime.invalidate('error', cause, { stage, recovery: 'context' })
      f.runtime.setOptions(false, 'low')
      f.begin()
      f.runtime.setOptions(true, 'high')
      f.receiver.getEndpointMaterial('far').defines.GENUINE_UNRELATED_LAYOUT = 1
      f.entry.generation++
      expect(f.begin()).toBeNull()
      f.runtime.resetScenario()
      expect(f.begin()).toBeNull()
      expect(f.runtime.error).toBe(cause)
      f.runtime.setContextLost(false)
      expect(f.begin()).toBeNull()
      f.runtime.setContextLost(true)
      f.runtime.setContextLost(false)
      f.entry.generation++
      expect(f.begin()).not.toBeNull()
      f.runtime.dispose()
    }
  )
  it.each(['replace', 'bitmap', 'evict'] as const)(
    'invalidates pending volume for independent scalar far-color %s without owning borrowed inputs',
    async (kind) => {
      const f = fixture(true)
      f.body.resourcePaths = new Map([
        [26, 'runtime-test'],
        [27, 'runtime-color']
      ])
      f.body.descriptor.far = {
        mapping: f.body.descriptor.volume!.mapping,
        pattern: {
          kind: 'mask',
          encoding: 'scalar',
          map: { resourceId: 26 },
          decode: { channel: 'r', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'encoded' }
        },
        color: { kind: 'map', map: { resourceId: 27 }, strength: 1 }
      }
      const color = new DataTexture(new Uint8Array([32, 64, 128, 255]), 1, 1)
      color.name = 'runtime-color'
      resourceStorage.addTexture(color)
      const colorDispose = vi.spyOn(color, 'dispose'),
        preparedDispose = vi.spyOn(f.prepared, 'dispose')
      f.begin()
      expect(f.receiver.setFarMap.mock.lastCall![2]).toBe(color)
      if (kind === 'replace') {
        const next = new Texture()
        next.name = color.name
        resourceStorage.addTexture(next)
      }
      if (kind === 'bitmap') color.image = { data: new Uint8Array([128, 64, 32, 255]), width: 1, height: 1 }
      if (kind === 'evict') resourceStorage.deleteTexture(color.name)
      f.complete()
      await Promise.resolve()
      expect(preparedDispose).toHaveBeenCalledOnce()
      expect(f.receiver.setFarMap.mock.lastCall!.slice(0, 2)).toEqual([null, null])
      expect(f.createBackend).not.toHaveBeenCalled()
      expect(colorDispose).toHaveBeenCalledTimes(kind === 'evict' ? 1 : 0)
      f.runtime.dispose()
    }
  )
  it('immediately resizes owned targets and clears capture-era output without an extra draw', () => {
    const f = fixture(),
      plan = f.begin()!,
      target = new WebGLRenderTarget()
    const output = f.runtime.renderVolume({} as never, target, plan, {
      serial: plan.frame.serial,
      viewport: size,
      texture: new Texture(),
      sceneLogFarFactor: 1,
      sceneUnitsToMeters: 1
    })!
    f.runtime.useEndpoint(plan, output)
    f.runtime.setSize(48, 36)
    expect(f.backend.setSize).toHaveBeenCalledWith(48, 36)
    expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
    expect(f.receiver.setEndpoint.mock.lastCall![1]).toBeNull()
    expect(f.backend.render).toHaveBeenCalledOnce()
    f.runtime.setSize(48, 36)
    expect(f.backend.setSize).toHaveBeenCalledOnce()
    f.runtime.dispose()
    target.dispose()
  })
  it('does not allocate or resize GPU owners for far-only, lost, or disposed runtimes', () => {
    const f = fixture()
    f.runtime.setSize(100, 100)
    expect(f.createBackend).not.toHaveBeenCalled()
    f.runtime.setContextLost(true)
    f.runtime.setSize(100, 100)
    f.runtime.dispose()
    f.runtime.setSize(100, 100)
    expect(f.backend.setSize).not.toHaveBeenCalled()
  })
  it.each(['scenario', 'quality', 'context', 'dispose', 'eviction', 'bitmap'] as const)(
    'rejects ignored-abort preparation after %s',
    async (kind) => {
      const f = fixture(true)
      const source = resourceStorage.getTexture('runtime-test')!
      const borrowedDispose = vi.spyOn(source, 'dispose')
      const dispose = vi.spyOn(f.prepared, 'dispose')
      f.begin()
      if (kind === 'scenario') f.runtime.resetScenario()
      if (kind === 'quality') f.runtime.setOptions(true, 'low')
      if (kind === 'context') f.runtime.setContextLost(true)
      if (kind === 'dispose') f.runtime.dispose()
      if (kind === 'eviction') resourceStorage.deleteTexture('runtime-test')
      if (kind === 'bitmap') source.image = { data: new Uint8Array([1, 2, 3, 255]), width: 1, height: 1 }
      f.complete()
      await Promise.resolve()
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(f.createBackend).not.toHaveBeenCalled()
      expect(f.receiver.setEndpoint.mock.calls.every((call) => call[1] === null)).toBe(true)
      expect(borrowedDispose).toHaveBeenCalledTimes(kind === 'eviction' ? 1 : 0)
      f.runtime.dispose()
    }
  )
  it('clears near bindings before disposing output owners and keeps off far maps cleared', () => {
    const f = fixture(),
      plan = f.begin()!,
      target = new WebGLRenderTarget()
    const output = f.runtime.renderVolume({} as never, target, plan, {
      serial: plan.frame.serial,
      viewport: size,
      texture: new Texture(),
      sceneLogFarFactor: 1,
      sceneUnitsToMeters: 1
    })!
    f.runtime.useEndpoint(plan, output)
    const events: string[] = []
    f.receiver.setEndpoint.mockImplementation((_frame, current) => {
      if (current === null) events.push('clear')
    })
    f.backend.dispose.mockImplementation(() => {
      events.push('dispose')
    })
    f.runtime.setOptions(false, 'medium')
    expect(events.indexOf('clear')).toBeLessThan(events.indexOf('dispose'))
    f.begin()
    expect(f.receiver.setFarMap.mock.lastCall!.slice(0, 2)).toEqual([null, null])
    f.runtime.dispose()
    target.dispose()
  })
  it('holds context loss until a current ready LUT and fresh successful output exist', () => {
    const f = fixture()
    f.begin()
    f.runtime.setContextLost(true)
    expect(f.begin()).toBeNull()
    expect(f.runtime.diagnostics.state).toBe('context-lost')
    f.entry.ready = false
    f.runtime.setContextLost(false)
    expect(f.begin()).toBeNull()
    expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
    f.entry.generation++
    f.entry.ready = true
    expect(f.begin()).not.toBeNull()
    expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
    f.runtime.dispose()
  })
  it('resets backend history only on discontinuity and cloned local camera changes', () => {
    const f = fixture(),
      target = new WebGLRenderTarget()
    const draw = () => {
      const plan = f.begin()!
      return f.runtime.renderVolume({} as never, target, plan, {
        serial: plan.frame.serial,
        viewport: size,
        texture: new Texture(),
        sceneLogFarFactor: 1,
        sceneUnitsToMeters: 1
      })
    }
    draw()
    const initial = f.backend.resetHistory.mock.calls.length
    f.camera.position.x += SpaceScale / 1000
    draw()
    expect(f.backend.resetHistory).toHaveBeenCalledTimes(initial)
    f.camera.position.x += (100000 * SpaceScale) / 1000
    draw()
    expect(f.backend.resetHistory).toHaveBeenCalledTimes(initial + 1)
    f.runtime.resetHistory()
    draw()
    expect(f.backend.resetHistory).toHaveBeenCalledTimes(initial + 2)
    f.runtime.dispose()
    target.dispose()
  })
  it('latches a receiver link failure and retries its owned program once after a real layout change', () => {
    const f = fixture(),
      plan = f.begin()!
    const target = new WebGLRenderTarget()
    expect(() => f.runtime.getEndpointMaterialBindings(plan)).toThrow('accepted current')
    f.runtime.renderVolume({} as never, target, plan, {
      serial: plan.frame.serial,
      viewport: size,
      texture: new Texture(),
      sceneLogFarFactor: 1,
      sceneUnitsToMeters: 1
    })
    expect(f.runtime.getEndpointMaterialBindings(plan).size).toBe(1)
    const failure = Error('near receiver link')
    f.runtime.invalidate('error', failure, { stage: 'near', recovery: 'owned-near', receivers: [f.receiver] })
    expect(f.begin()).toBeNull()
    expect(f.runtime.error).toBe(failure)
    expect(f.receiver.retryEndpointMaterial).not.toHaveBeenCalled()
    const owner = f.receiver.getEndpointMaterial('far')
    owner.defines.USE_REAL_LAYOUT_CHANGE = 1
    owner.needsUpdate = true
    expect(f.begin()).not.toBeNull()
    expect(f.receiver.retryEndpointMaterial).toHaveBeenCalledTimes(1)
    expect(f.begin()).not.toBeNull()
    expect(f.receiver.retryEndpointMaterial).toHaveBeenCalledTimes(1)
    f.runtime.dispose()
    target.dispose()
  })
  it('diagnoses unsupported authored patterns before preparation while retaining far', () => {
    const f = fixture()
    f.body.descriptor.volume!.layers[0].pattern = { kind: 'uniform', coverage: 0.5 }
    expect(f.begin()).toBeNull()
    expect(f.runtime.diagnostics.reason).toBe('unsupported-config')
    expect(f.begin()).toBeNull()
    expect(f.runtime.diagnostics.reason).toBe('unsupported-config')
    expect(f.prepare).not.toHaveBeenCalled()
    f.runtime.dispose()
  })
  it('does not retry a failed volume each frame without a changed generation', () => {
    const f = fixture()
    const plan = f.begin()!
    f.backend.render.mockImplementation(() => {
      throw new Error('unavailable renderer')
    })
    f.runtime.renderVolume({} as never, new WebGLRenderTarget(), plan, {
      serial: plan.frame.serial,
      viewport: size,
      texture: new Texture(),
      sceneLogFarFactor: 1,
      sceneUnitsToMeters: 1
    })
    expect(f.begin()).toBeNull()
    expect(f.runtime.diagnostics.reason).toBe('error')
    expect(f.backend.updateCounts).toEqual({ cloudUpdates: 0, shadowUpdates: 0 })
    f.runtime.dispose()
  })
  it('counts attempted updates through a stable backend getter even when render throws after entry', () => {
    const f = fixture()
    const plan = f.begin()!
    const counts = f.backend.updateCounts
    f.backend.render.mockImplementation(() => {
      counts.cloudUpdates++
      counts.shadowUpdates++
      throw new Error('deferred shader failure')
    })
    expect(
      f.runtime.renderVolume({} as never, new WebGLRenderTarget(), plan, {
        serial: plan.frame.serial,
        viewport: size,
        texture: new Texture(),
        sceneLogFarFactor: 1,
        sceneUnitsToMeters: 1
      })
    ).toBeNull()
    expect(f.runtime.diagnostics.cloudUpdates).toBe(1)
    expect(f.runtime.diagnostics.shadowUpdates).toBe(1)
    f.runtime.dispose()
  })
  it('keeps current body/camera far frames at zero weight without preparation or GPU owners', () => {
    const f = fixture()
    f.camera.position.z *= 100
    expect(f.begin()).toBeNull()
    f.camera.position.x += 1
    f.body.object.position.y += 2
    expect(f.begin()).toBeNull()
    f.runtime.useEndpoint(null, null)
    const frame = f.receiver.setEndpoint.mock.lastCall![0]!
    expect(frame.serial).toBe(2)
    expect(frame.centerWorld.y).toBe(2)
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.createBackend).not.toHaveBeenCalled()
    f.runtime.dispose()
  })
  it('prepared is not ready; only a fresh current successful output can enable near', () => {
    const f = fixture()
    const plan = f.begin()!
    expect(plan).not.toBeNull()
    expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
    expect(f.runtime.diagnostics.state).toBe('prepared')
    const output = f.runtime.renderVolume({} as never, new WebGLRenderTarget(), plan, {
      serial: plan.frame.serial,
      viewport: size,
      texture: new Texture(),
      sceneLogFarFactor: 1,
      sceneUnitsToMeters: 1
    })!
    expect(output.shadow).toBeNull()
    expect(f.backend.render).toHaveBeenCalledTimes(1)
    f.runtime.useEndpoint(plan, output)
    expect(f.runtime.diagnostics.effectiveWeight).toBe(1)
    f.begin()
    f.runtime.useEndpoint(plan, output)
    expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
    f.runtime.useEndpoint(null, null)
    expect(f.receiver.setEndpoint.mock.lastCall![1]).toBeNull()
    f.runtime.dispose()
  })
  it('keeps moving far frames while pending and rejects obsolete ignored-abort results', async () => {
    const f = fixture(true)
    expect(f.begin()).toBeNull()
    expect(f.runtime.diagnostics.state).toBe('preparing')
    f.camera.position.x += 1
    expect(f.begin()).toBeNull()
    expect(f.receiver.setEndpoint.mock.lastCall![0]!.serial).toBe(2)
    const dispose = vi.spyOn(f.prepared, 'dispose')
    f.runtime.setOptions(false, 'high')
    f.complete()
    await Promise.resolve()
    await Promise.resolve()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(f.createBackend).not.toHaveBeenCalled()
    f.runtime.dispose()
  })
  it.each(['lens', 'slot', 'pending-lut'])('preserves far and avoids preparation for %s fallback', (kind) => {
    const f = fixture()
    if (kind === 'slot') f.entry.bodyActorId = 9
    if (kind === 'pending-lut') f.entry.ready = false
    expect(f.begin(kind === 'lens')).toBeNull()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
    f.runtime.dispose()
  })
  it('clears borrowed far bindings synchronously before source eviction', () => {
    const f = fixture()
    f.begin()
    const events: string[] = []
    f.receiver.setFarMap.mockImplementation((_map, source) => {
      if (source === null) events.push('clear')
    })
    resourceStorage.getTexture('runtime-test')!.addEventListener('dispose', () => events.push('dispose'))
    resourceStorage.deleteTexture('runtime-test')
    expect(events.indexOf('clear')).toBeLessThan(events.indexOf('dispose'))
    f.runtime.dispose()
  })
})
