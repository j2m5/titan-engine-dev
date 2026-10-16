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
    f.runtime.invalidate('error', failure, true)
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
