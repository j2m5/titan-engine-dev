import type { PerspectiveCamera, ShaderMaterial, Texture, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three'
import { CloudRegistry, type CloudBodyEntry } from '@/core/services/CloudRegistry'
import type { AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import type { AtmosphereFrameSnapshot } from '@/core/graphic/effects/atmosphere/atmosphereFrame'
import type { SceneCloudDepthFrame } from '@/core/graphic/clouds/SceneCloudDepth'
import { SceneCloudBackend, type SceneCloudOutput } from './takram/SceneCloudBackend'
import type { EnabledCloudConfig } from './CloudConfig'
import type { CloudQuality, CloudQualityProfile } from './SceneCloudConfig'
import { captureCloudFrame, type CloudFrame } from './scene/CloudFrame'
import { cloudBodyCandidate, selectCloudBody } from './scene/cloudSelection'
import { cloudVolumeOpacity } from './cloudLod'
import { CloudSources } from './CloudSources'
import type { prepareCloudSource } from './appearance/prepareCloudSource'
import { prepareCloudSourceAsync } from './appearance/prepareCloudSourceAsync'
import { assertCloudAppearanceSupport } from './appearance/cloudAppearance'
import { sceneCloudProgramSignature } from './receivers/sceneCloudEndpointMaterial'
import type { SceneCloudReceiver } from './receivers/SceneCloudReceiver'

export type CloudFallbackReason =
  | 'unconfigured'
  | 'off'
  | 'outside-lod'
  | 'resources'
  | 'preparing'
  | 'unsupported-config'
  | 'atmosphere'
  | 'lens'
  | 'debug-view'
  | 'error'
  | 'context-lost'
  | null
export interface CloudFramePlan {
  frame: CloudFrame
  atmosphere: AtmosphereEntry
  requestedWeight: number
}
export interface CloudDiagnostics {
  actorId: number | null
  state: 'unconfigured' | 'waiting' | 'preparing' | 'prepared' | 'ready' | 'active' | 'error' | 'context-lost'
  requestedWeight: number
  effectiveWeight: number
  reason: CloudFallbackReason
  depthPasses: number
  cloudUpdates: number
  shadowUpdates: number
  farRenders: number
  nearRenders: number
  finalRenders: number
}
export type CloudPassCounts = Pick<
  CloudDiagnostics,
  'depthPasses' | 'cloudUpdates' | 'shadowUpdates' | 'farRenders' | 'nearRenders' | 'finalRenders'
>
type Prepared = ReturnType<typeof prepareCloudSource>
export interface SceneCloudRuntimeDeps {
  createBackend: (
    frame: CloudFrame,
    atmosphere: AtmosphereEntry,
    prepared: Prepared,
    profile: CloudQualityProfile,
    quality: CloudQuality
  ) => Pick<SceneCloudBackend, 'render' | 'resetHistory' | 'setSize' | 'dispose' | 'updateCounts'>
  prepare: (
    config: EnabledCloudConfig,
    resolveTexture: (id: number) => Texture | undefined,
    options?: { signal?: AbortSignal }
  ) => Prepared | Promise<Prepared>
}
export class SceneCloudRuntime {
  private readonly deps: SceneCloudRuntimeDeps
  private readonly frames = new Map<number, CloudFrame | null>()
  private readonly sources = new Map<number, { body: CloudBodyEntry; sources: CloudSources }>()
  private readonly stop: () => void
  private enabled = true
  private quality: CloudQuality = 'high'
  private selected: CloudBodyEntry | null = null
  private key = ''
  private generation = 0
  private abort: AbortController | null = null
  private prepared: Prepared | null = null
  private backend: ReturnType<SceneCloudRuntimeDeps['createBackend']> | null = null
  private output: SceneCloudOutput | null = null
  private plan: CloudFramePlan | null = null
  private disposed = false
  private failure: unknown = null
  private failedLayout: string | null = null
  private readonly retryReceivers = new Set<SceneCloudReceiver>()
  private readonly stats: CloudDiagnostics = {
    actorId: null,
    state: 'unconfigured',
    requestedWeight: 0,
    effectiveWeight: 0,
    reason: 'unconfigured',
    depthPasses: 0,
    cloudUpdates: 0,
    shadowUpdates: 0,
    farRenders: 0,
    nearRenders: 0,
    finalRenders: 0
  }
  public constructor(
    private readonly registry: CloudRegistry,
    dependencies: Partial<SceneCloudRuntimeDeps> = {}
  ) {
    this.deps = {
      createBackend: (...args) => new SceneCloudBackend(...args),
      prepare: prepareCloudSourceAsync,
      ...dependencies
    }
    this.stop = registry.subscribe((id) => {
      this.sources.get(id)?.sources.dispose()
      this.sources.delete(id)
      this.frames.delete(id)
      if (this.selected?.actorId === id) {
        this.release()
        this.selected = null
      }
    })
  }
  public setOptions(enabled: boolean, quality: CloudQuality): void {
    if (this.enabled === enabled && this.quality === quality) return
    this.enabled = enabled
    this.quality = quality
    this.release()
    this.useEndpoint(null, null)
  }
  private release(): void {
    this.generation++
    this.abort?.abort()
    this.abort = null
    this.output = null
    this.plan = null
    this.stats.effectiveWeight = 0
    this.backend?.dispose()
    this.backend = null
    this.prepared?.dispose()
    this.prepared = null
    this.key = ''
    this.failedLayout = null
  }
  private fallback(reason: CloudFallbackReason): null {
    this.stats.reason = reason
    this.stats.effectiveWeight = 0
    this.useEndpoint(null, null)
    return null
  }
  public beginFrame(
    camera: PerspectiveCamera,
    viewport: Vector2,
    serial: number,
    deltaSeconds: number,
    atmosphere: AtmosphereFrameSnapshot,
    lensActive: boolean,
    atmosphereDebugView: number
  ): CloudFramePlan | null {
    if (this.disposed) return null
    this.output = null
    this.plan = null
    this.stats.effectiveWeight = 0
    this.stats.requestedWeight = 0
    const bodies = this.registry.entries()
    // Far datum frames are current even when volume is off, pending, or unsupported.
    for (const body of bodies) {
      let owner = this.sources.get(body.actorId)
      if (!owner || owner.body !== body) {
        owner?.sources.dispose()
        const sources = new CloudSources(body.resourcePaths, () => {
          for (const receiver of this.registry.receivers(body.actorId)) {
            receiver.setEndpoint(this.frames.get(body.actorId) ?? null, null)
            receiver.setFarMap(null, null)
          }
          if (this.selected === body) {
            this.release()
            this.stats.state = 'waiting'
            this.stats.reason = 'resources'
          }
        })
        owner = { body, sources }
        this.sources.set(body.actorId, owner)
      }
      owner.sources.poll()
      const frame = captureCloudFrame(body, camera, viewport, serial, deltaSeconds)
      this.frames.set(body.actorId, frame)
      const map = body.descriptor.far
      const source = map ? (owner.sources.read(map.pattern.map.resourceId)?.texture ?? null) : null
      const color =
        map?.pattern.encoding !== 'rgb-cloud-map' && map?.color.kind === 'map'
          ? map.color.map.resourceId === map.pattern.map.resourceId
            ? source
            : (owner.sources.read(map.color.map.resourceId)?.texture ?? null)
          : null
      for (const receiver of this.registry.receivers(body.actorId)) {
        receiver.setFarMap(map, source, color)
        receiver.setEndpoint(frame, null)
      }
    }
    if (!this.enabled) {
      this.release()
      this.stats.state = 'waiting'
      return this.fallback('off')
    }
    const candidates = bodies.map((body) => cloudBodyCandidate(body, camera)).filter((c) => c !== null)
    const id = selectCloudBody(candidates, this.selected?.actorId ?? null)
    const body = bodies.find((b) => b.actorId === id) ?? null
    if (body !== this.selected) {
      this.release()
      this.selected = body
    }
    this.stats.actorId = id
    if (!body) {
      this.stats.state = bodies.length ? 'waiting' : 'unconfigured'
      return this.fallback(
        bodies.some((b) => b.descriptor.state === 'off') ? 'off' : bodies.length ? 'outside-lod' : 'unconfigured'
      )
    }
    const frame = this.frames.get(body.actorId)
    const slot =
      atmosphere.serial === serial
        ? atmosphere.slots.find(
            (s) => s.entry.bodyActorId === body.actorId && s.entry.ready && s.generation === s.entry.generation
          )
        : undefined
    if (!frame || !slot || lensActive || atmosphereDebugView) {
      this.release()
      this.stats.state = 'waiting'
      return this.fallback(lensActive ? 'lens' : atmosphereDebugView ? 'debug-view' : 'atmosphere')
    }
    const config = body.descriptor.volume!
    const candidate = candidates.find((c) => c.actorId === id)!
    const weight = cloudVolumeOpacity(candidate.shellDistanceMeters, config.lod)
    this.stats.requestedWeight = weight
    if (this.stats.state === 'error' && this.failedLayout !== null && this.failedLayout !== this.receiverLayout()) {
      this.release()
      this.stats.state = 'waiting'
    }
    const key = JSON.stringify([body.descriptor, this.quality, slot.entry.actorId, slot.generation])
    if (key !== this.key) {
      this.release()
      this.key = key
      for (const receiver of this.retryReceivers) receiver.retryEndpointMaterial()
      this.retryReceivers.clear()
      try {
        assertCloudAppearanceSupport(config)
      } catch (error) {
        this.failure = error
        this.stats.state = 'error'
        return this.fallback('unsupported-config')
      }
      const sources = this.sources.get(body.actorId)!.sources
      const resolve = (resourceId: number) => sources.read(resourceId)?.texture
      const layer = config.layers[0]
      if (
        (layer.pattern.kind === 'mask' || layer.pattern.kind === 'appearance') &&
        (!resolve(layer.pattern.map.resourceId) || (layer.color.kind === 'map' && !resolve(layer.color.map.resourceId)))
      ) {
        this.key = ''
        this.stats.state = 'waiting'
        return this.fallback('resources')
      }
      this.stats.state = 'preparing'
      this.abort = new AbortController()
      const generation = this.generation
      const publish = (result: Prepared) => {
        sources.poll()
        if (this.disposed || generation !== this.generation) {
          result.dispose()
          return
        }
        this.prepared = result
        this.stats.state = 'prepared'
      }
      try {
        const result = this.deps.prepare(config, resolve, { signal: this.abort.signal })
        if (result instanceof Promise)
          result.then(publish, (error) => {
            if (generation === this.generation && !this.disposed) {
              this.stats.state = 'error'
              this.stats.reason = 'error'
              this.failure = error
            }
          })
        else publish(result)
      } catch (error) {
        this.failure = error
        this.stats.state = 'error'
        this.stats.reason = 'error'
      }
    }
    if (this.stats.state === 'error')
      return this.fallback(this.stats.reason === 'unsupported-config' ? 'unsupported-config' : 'error')
    if (!this.prepared) return this.fallback('preparing')
    this.plan = { frame, atmosphere: slot.entry, requestedWeight: weight }
    this.stats.reason = null
    return this.plan
  }
  public renderVolume(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget,
    plan: CloudFramePlan,
    depth: SceneCloudDepthFrame
  ): SceneCloudOutput | null {
    if (plan !== this.plan || !this.prepared || !this.selected) return null
    this.sources.get(this.selected.actorId)!.sources.poll()
    if (!this.prepared || plan !== this.plan) return null
    try {
      this.backend ??= this.deps.createBackend(
        plan.frame,
        plan.atmosphere,
        this.prepared,
        this.selected.descriptor.qualityProfile,
        this.quality
      )
      const backend = this.backend
      const clouds = backend.updateCounts.cloudUpdates,
        shadows = backend.updateCounts.shadowUpdates
      let output: SceneCloudOutput
      try {
        output = backend.render(renderer, inputBuffer, plan.frame, depth, plan.atmosphere)
      } finally {
        this.recordPasses({
          cloudUpdates: backend.updateCounts.cloudUpdates - clouds,
          shadowUpdates: backend.updateCounts.shadowUpdates - shadows
        })
      }
      if (
        output.frame !== plan.frame ||
        output.atmosphereActorId !== plan.atmosphere.actorId ||
        output.atmosphereGeneration !== plan.atmosphere.generation ||
        !plan.atmosphere.ready
      )
        throw new Error('Stale cloud output')
      this.output = output
      this.stats.state = 'ready'
      return output
    } catch (error) {
      this.invalidate('error', error)
      return null
    }
  }
  public useEndpoint(plan: CloudFramePlan | null, output: SceneCloudOutput | null): void {
    const valid = plan !== null && plan === this.plan && output !== null && output === this.output
    if (valid) this.stats.effectiveWeight = plan.requestedWeight
    else if (plan) this.stats.effectiveWeight = 0
    if (valid) this.stats.state = 'active'
    for (const body of this.registry.entries())
      for (const receiver of this.registry.receivers(body.actorId))
        receiver.setEndpoint(
          this.frames.get(body.actorId) ?? null,
          valid && body.actorId === plan.frame.actorId ? output : null
        )
  }
  private receiverLayout(): string {
    return JSON.stringify(
      this.selected
        ? this.registry
            .receivers(this.selected.actorId)
            .map((receiver) => sceneCloudProgramSignature(receiver.getEndpointMaterial('far')))
        : []
    )
  }
  public getEndpointMaterialBindings(plan: CloudFramePlan): ReadonlyMap<ShaderMaterial, ShaderMaterial> {
    if (plan !== this.plan || this.output?.frame !== plan.frame || this.selected?.actorId !== plan.frame.actorId)
      throw new Error('Near materials require the accepted current cloud output')
    return new Map(
      this.registry
        .receivers(this.selected.actorId)
        .map((receiver) => [receiver.getEndpointMaterial('far'), receiver.getEndpointMaterial('near')])
    )
  }
  public invalidate(reason: CloudFallbackReason, cause?: unknown, retryNearProgram = false): void {
    this.failure = cause ?? null
    this.output = null
    this.plan = null
    this.stats.effectiveWeight = 0
    this.stats.reason = reason
    this.stats.state = reason === 'context-lost' ? 'context-lost' : 'error'
    this.failedLayout = this.receiverLayout()
    if (retryNearProgram && this.selected)
      for (const receiver of this.registry.receivers(this.selected.actorId)) this.retryReceivers.add(receiver)
    this.useEndpoint(null, null)
  }
  public recordPasses(counts: Partial<CloudPassCounts>): void {
    for (const [key, value] of Object.entries(counts)) this.stats[key as keyof CloudPassCounts] += value
  }
  public get diagnostics(): Readonly<CloudDiagnostics> {
    return { ...this.stats }
  }
  public get error(): unknown {
    return this.failure
  }
  public dispose(): void {
    if (this.disposed) return
    this.useEndpoint(null, null)
    this.release()
    this.disposed = true
    this.stop()
    for (const { sources } of this.sources.values()) sources.dispose()
    this.sources.clear()
    this.frames.clear()
  }
}
