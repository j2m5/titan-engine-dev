import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Color,
  Data3DTexture,
  DataTexture,
  Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  WebGLRenderTarget
} from 'three'
import { SceneCloudRuntime } from '@/core/clouds/SceneCloudRuntime'
import { CloudRegistry, type CloudBodyEntry } from '@/core/services/CloudRegistry'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import { bindResourceStorageContext, resourceStorage } from '@/core/services/ResourceStorage'
import { Postprocessing } from '@/core/graphic/Postprocessing'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import type { SceneCloudOutput } from '@/core/clouds/takram/SceneCloudBackend'
import type { AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import type { AtmosphereFrameSnapshot } from '@/core/graphic/effects/atmosphere/atmosphereFrame'
import { SpaceScale } from '@/core/constants'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import { bindSceneCloudReceiver } from '@/core/clouds/receivers/SceneCloudReceiver'
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
    shadowCascadeCount: 3,
    prepare: vi.fn(() => true),
    get updateCounts() {
      return counts
    },
    render: vi.fn((_r: unknown, _i: unknown, frame: CloudFrame) => {
      counts.cloudUpdates++
      counts.shadowUpdates++
      return {
        frame,
        atmosphereActorId: 8,
        atmosphereGeneration: entry.generation,
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
  const begin = (lens = false, delta = 0.016) => {
    const atmo = snapshot()
    return runtime.beginFrame(camera, size, atmo.serial, delta, atmo, lens, 0)
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
  it('refreshes near material state after preparation while retaining receiver attribution', () => {
    const f = fixture(),
      target = new WebGLRenderTarget(),
      material = new ShaderMaterial({ fragmentShader: 'void main() {}' }),
      receiver = bindSceneCloudReceiver(material, 'sphere'),
      unbind = f.registry.bindReceiver(7, receiver)
    try {
      const plan = f.begin()!
      expect(f.runtime.prepareVolume({} as never, target, plan)).toBe(true)
      const prepared = f.runtime.getPreparationMaterialBindings(plan).get(material)!
      const version = prepared.version
      // A depth draw or streaming callback can change the owner after warmup.
      material.opacity = 0.4
      material.defines.LIVE_LAYOUT = 1
      material.uniforms.live = { value: 7 }
      f.runtime.renderVolume({} as never, target, plan, {
        serial: plan.frame.serial,
        viewport: size,
        texture: new Texture(),
        sceneLogFarFactor: 1,
        sceneUnitsToMeters: 1
      })
      const endpoint = f.runtime.getEndpointMaterials(plan)
      expect(endpoint.bindings.size).toBe(2)
      expect(endpoint.bindings.get(material)).toBe(prepared)
      expect(endpoint.owners.get(prepared)).toBe(receiver)
      expect(prepared.opacity).toBe(0.4)
      expect(prepared.defines.LIVE_LAYOUT).toBe(1)
      expect(prepared.uniforms.live).toBe(material.uniforms.live)
      expect(prepared.version).toBe(version + 1)
      material.uniforms.live = { value: 9 }
      expect(f.runtime.getEndpointMaterials(plan).bindings.get(material)?.uniforms.live).toBe(material.uniforms.live)
      f.begin()
      expect(() => f.runtime.getEndpointMaterials(plan)).toThrow('accepted current')
    } finally {
      f.runtime.dispose()
      unbind()
      receiver.dispose()
      material.dispose()
      target.dispose()
    }
  })
  it('does not inspect receiver program keys for retry while no compilation failure is latched', () => {
    const f = fixture()
    const owner = f.receiver.getEndpointMaterial('far')
    let programKeyReads = 0
    owner.customProgramCacheKey = () => {
      programKeyReads++
      return 'healthy-receiver'
    }
    try {
      for (let i = 0; i < 4; i++) expect(f.begin()).not.toBeNull()
      expect(programKeyReads).toBe(0)
    } finally {
      f.runtime.dispose()
    }
  })
  it('fades successful frames in without consuming preparation time or advancing twice per output', () => {
    const f = fixture()
    const input = new WebGLRenderTarget()
    const present = (delta: number, activate = true) => {
      const plan = f.begin(false, delta)!
      const output = f.runtime.renderVolume({} as never, input, plan, {
        serial: plan.frame.serial,
        viewport: size,
        texture: new Texture(),
        sceneLogFarFactor: 1,
        sceneUnitsToMeters: 1
      })!
      f.runtime.useEndpoint(plan, output, activate)
      const weight = f.runtime.diagnostics.effectiveWeight
      f.runtime.useEndpoint(plan, output, activate)
      expect(f.runtime.diagnostics.effectiveWeight).toBe(weight)
      return weight
    }
    try {
      for (let i = 0; i < 10; i++) f.begin(false, 1)
      expect(present(5, false)).toBe(0)
      const first = present(5)
      expect(first).toBeGreaterThan(0)
      expect(first).toBeLessThan(0.1)
      let previous = first
      for (let i = 0; i < 40; i++) {
        const next = present(0.016)
        expect(next).toBeGreaterThanOrEqual(previous)
        previous = next
      }
      expect(previous).toBe(1)
      f.runtime.resetHistory()
      expect(present(0)).toBe(1)
      f.runtime.setOptions(false, 'medium')
      f.runtime.setOptions(true, 'medium')
      expect(present(0.016)).toBeLessThan(0.1)
    } finally {
      f.runtime.dispose()
      input.dispose()
    }
  })
  it('holds the far endpoint while GPU programs prepare and rejects a cancelled preparation plan', () => {
    const f = fixture(),
      input = new WebGLRenderTarget()
    try {
      f.backend.prepare.mockReturnValue(false)
      const plan = f.begin()!
      expect(f.runtime.prepareVolume({} as never, input, plan)).toBe(false)
      expect(f.runtime.diagnostics).toMatchObject({
        state: 'warming',
        reason: 'preparing',
        effectiveWeight: 0,
        cloudUpdates: 0,
        shadowUpdates: 0
      })
      f.runtime.setOptions(false, 'medium')
      expect(f.runtime.prepareVolume({} as never, input, plan)).toBe(false)
      expect(f.backend.prepare).toHaveBeenCalledOnce()
      expect(f.backend.dispose).toHaveBeenCalledOnce()
    } finally {
      f.runtime.dispose()
      input.dispose()
    }
  })
  it.each(['add', 'replace', 'evict'] as const)(
    'keeps pending Earth preparation across unused actor texture %s',
    async (kind) => {
      const f = fixture(true)
      f.body.resourcePaths = new Map([
        [26, 'runtime-test'],
        [99, 'unused-earth-night']
      ])
      const unused = new Texture()
      unused.name = 'unused-earth-night'
      if (kind !== 'add') resourceStorage.addTexture(unused)
      const borrowed = resourceStorage.getTexture('runtime-test')!
      const borrowedDispose = vi.spyOn(borrowed, 'dispose')
      const derivativeDispose = vi.spyOn(f.prepared, 'dispose')
      try {
        expect(f.begin()).toBeNull()
        expect(f.runtime.diagnostics.state).toBe('preparing')
        if (kind === 'add') resourceStorage.addTexture(unused)
        if (kind === 'replace') {
          const replacement = new Texture()
          replacement.name = unused.name
          resourceStorage.addTexture(replacement)
        }
        if (kind === 'evict') resourceStorage.deleteTexture(unused.name)
        expect(f.runtime.diagnostics.state).toBe('preparing')
        f.begin()
        expect(f.prepare).toHaveBeenCalledOnce()
        f.complete()
        await Promise.resolve()
        expect(f.runtime.diagnostics.state).toBe('prepared')
        expect(f.begin()).not.toBeNull()
        expect(derivativeDispose).not.toHaveBeenCalled()
        expect(borrowedDispose).not.toHaveBeenCalled()
      } finally {
        f.runtime.dispose()
      }
    }
  )
  it('reports missing far source/color per body without replacing the selected volume reason and clears lifecycle snapshots', () => {
    const f = fixture()
    const far = {
      ...f.body,
      actorId: 13,
      descriptor: {
        ...f.body.descriptor,
        volume: null,
        far: {
          ...f.body.descriptor.far!,
          pattern: {
            kind: 'mask' as const,
            map: { resourceId: 37 },
            decode: {
              channel: 'r' as const,
              inputRange: [0, 1] as [number, number],
              exponent: 1,
              invert: false,
              sampleSpace: 'linear' as const
            }
          },
          color: { kind: 'map' as const, map: { resourceId: 38 }, strength: 1 }
        }
      },
      resourcePaths: new Map([
        [37, 'far-pattern'],
        [38, 'far-color']
      ])
    }
    const unregister = f.registry.register(far)
    expect(f.begin()).not.toBeNull()
    expect(f.runtime.diagnostics.actorId).toBe(7)
    expect(f.runtime.diagnostics.reason).toBeNull()
    expect(f.runtime.diagnostics.farFallbacks).toEqual([{ actorId: 13, reason: 'resources' }])
    for (const name of ['far-pattern', 'far-color']) {
      const source = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
      source.name = name
      resourceStorage.addTexture(source)
      f.begin()
      expect(f.runtime.diagnostics.farFallbacks).toEqual(
        name === 'far-pattern' ? [{ actorId: 13, reason: 'resources' }] : []
      )
    }
    resourceStorage.deleteTexture('far-color')
    f.begin()
    expect(f.runtime.diagnostics.reason).toBeNull()
    expect(f.runtime.diagnostics.farFallbacks).toEqual([{ actorId: 13, reason: 'resources' }])
    f.runtime.setOptions(false, 'medium')
    expect(f.runtime.diagnostics.farFallbacks).toEqual([])
    f.runtime.setOptions(true, 'medium')
    f.begin()
    unregister()
    expect(f.runtime.diagnostics.farFallbacks).toEqual([])
    f.registry.register(far)
    f.begin()
    expect(f.runtime.diagnostics.farFallbacks).toHaveLength(1)
    f.runtime.resetScenario()
    expect(f.runtime.diagnostics.farFallbacks).toEqual([])
    f.runtime.dispose()
  })

  it.each(['depth', 'near'] as const)(
    'accepts fresh output after a latched %s failure and menu-time context recovery',
    (stage) => {
      const f = fixture(),
        canvas = document.createElement('canvas')
      let lost = false
      const renderer = {
        domElement: canvas,
        getContext: () => ({ isContextLost: () => lost }),
        getRenderTarget: () => null
      }
      const release = bindResourceStorageContext(renderer as never)
      const post = new Postprocessing(
        renderer as never,
        new Scene(),
        f.camera,
        null as never,
        null as never,
        undefined,
        f.runtime
      )
      const composer = () => ({ dispose() {} }) as never
      const target = new WebGLRenderTarget()
      try {
        post.composer = composer()
        f.begin()
        const failure = Error('menu retained compilation failure')
        f.runtime.invalidate('error', failure, { stage, recovery: 'context' })
        post.dispose()
        // A restore assertion/event alone must never release a retained failed program.
        canvas.dispatchEvent(new Event('webglcontextrestored'))
        f.runtime.setContextLost(false)
        expect(f.begin()).toBeNull()
        expect(f.runtime.error).toBe(failure)
        lost = true
        canvas.dispatchEvent(new Event('webglcontextlost'))
        lost = false
        canvas.dispatchEvent(new Event('webglcontextrestored'))
        f.entry.generation++
        f.entry.ready = true
        post.composer = composer()
        post.initialize()
        expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
        const plan = f.begin()
        expect(plan, 'genuine menu recovery must unlock a fresh plan').not.toBeNull()
        const output = f.runtime.renderVolume(renderer as never, target, plan!, {
          serial: plan!.frame.serial,
          viewport: size,
          texture: new Texture(),
          sceneLogFarFactor: 1,
          sceneUnitsToMeters: 1
        })
        expect(output).not.toBeNull()
        f.runtime.useEndpoint(plan, output)
        expect(f.runtime.diagnostics.effectiveWeight).toBeGreaterThan(0)
        expect(f.runtime.error).toBeNull()
      } finally {
        post.dispose()
        f.runtime.dispose()
        target.dispose()
        release()
      }
    }
  )
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
    expect(() => f.runtime.getEndpointMaterials(plan)).toThrow('accepted current')
    f.runtime.renderVolume({} as never, target, plan, {
      serial: plan.frame.serial,
      viewport: size,
      texture: new Texture(),
      sceneLogFarFactor: 1,
      sceneUnitsToMeters: 1
    })
    const endpoint = f.runtime.getEndpointMaterials(plan)
    expect(endpoint.bindings.size).toBe(1)
    const near = endpoint.bindings.get(f.receiver.getEndpointMaterial('far'))!
    expect(endpoint.owners.get(near)).toBe(f.receiver)
    const failure = Error('near receiver link')
    f.runtime.invalidate('error', failure, { stage: 'near', recovery: 'owned-near', receivers: [f.receiver] })
    expect(() => f.runtime.getEndpointMaterials(plan)).toThrow('accepted current')
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
    expect(f.runtime.diagnostics.effectiveWeight).toBeGreaterThan(0)
    expect(f.runtime.diagnostics.effectiveWeight).toBeLessThan(1)
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
