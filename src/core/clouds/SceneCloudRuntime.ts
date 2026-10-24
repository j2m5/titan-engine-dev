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
import { shouldResetCloudHistory, type CloudHistoryStamp } from './scene/cloudLifecycle'
import { CloudCompilationFailures, type CloudCompilationEvidence } from './scene/cloudCompilationFailure'

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
  /** Missing declared far sources, independent from the selected volume fallback. */
  farFallbacks: ReadonlyArray<Readonly<{ actorId: number; reason: 'resources' }>>
  actorId: number | null
  state:
    | 'unconfigured'
    | 'waiting'
    | 'preparing'
    | 'prepared'
    | 'warming'
    | 'ready'
    | 'active'
    | 'error'
    | 'context-lost'
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
  ) => Pick<
    SceneCloudBackend,
    'prepare' | 'render' | 'resetHistory' | 'setSize' | 'dispose' | 'updateCounts' | 'shadowCascadeCount'
  >
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
  private quality: CloudQuality = 'medium'
  private contextLost = false
  private scenarioEpoch = 0
  private discontinuity = 0
  private history: CloudHistoryStamp | null = null
  private readonly atmosphereGenerations = new Map<AtmosphereEntry, number>()
  private readonly lostAtmospheres = new Map<AtmosphereEntry, number>()
  private selected: CloudBodyEntry | null = null
  private key = ''
  private generation = 0
  private abort: AbortController | null = null
  private prepared: Prepared | null = null
  private backend: ReturnType<SceneCloudRuntimeDeps['createBackend']> | null = null
  private targetSize: readonly [number, number] | null = null
  private output: SceneCloudOutput | null = null
  private plan: CloudFramePlan | null = null
  private activationSeconds = 0
  private activationSerial: number | null = null
  private disposed = false
  private failure: unknown = null
  private failedLayout: string | null = null
  private readonly compilationFailures = new CloudCompilationFailures()
  private readonly stats: CloudDiagnostics = {
    farFallbacks: [],
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
  public get preparationGeneration(): number {
    return this.generation
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
      this.stats.farFallbacks = this.stats.farFallbacks.filter((entry) => entry.actorId !== id)
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
    if (this.disposed) return
    if (this.enabled === enabled && this.quality === quality) return
    this.enabled = enabled
    this.quality = quality
    this.release()
    if (!enabled) this.clearFarMaps()
  }
  public bindRenderer(renderer: WebGLRenderer): void {
    this.compilationFailures.bind(renderer)
  }
  private clearFarMaps(): void {
    this.stats.farFallbacks = []
    for (const body of this.registry.entries())
      for (const receiver of this.registry.receivers(body.actorId)) receiver.setFarMap(null, null)
  }
  public setContextLost(lost: boolean): void {
    if (this.disposed || this.contextLost === lost) return
    this.contextLost = lost
    if (lost) this.compilationFailures.lost()
    else this.compilationFailures.restored()
    if (lost) {
      this.lostAtmospheres.clear()
      for (const [entry, generation] of this.atmosphereGenerations) this.lostAtmospheres.set(entry, generation)
    }
    this.release()
    this.clearFarMaps()
    for (const body of this.registry.entries())
      for (const receiver of this.registry.receivers(body.actorId)) receiver.retryEndpointMaterial()
    this.stats.state = lost ? 'context-lost' : 'waiting'
    this.stats.reason = lost ? 'context-lost' : 'atmosphere'
  }
  public resetScenario(): void {
    if (this.disposed) return
    this.scenarioEpoch++
    this.release()
    this.clearFarMaps()
    for (const { sources } of this.sources.values()) sources.dispose()
    this.sources.clear()
    this.frames.clear()
    this.atmosphereGenerations.clear()
    this.lostAtmospheres.clear()
    this.selected = null
    this.failure = null
    this.stats.actorId = null
    this.stats.state = 'unconfigured'
    this.stats.reason = 'unconfigured'
  }
  public resetHistory(): void {
    if (this.disposed) return
    this.discontinuity++
    this.output = null
    this.plan = null
    this.stats.effectiveWeight = 0
    this.useEndpoint(null, null)
  }
  /** Physical drawing-buffer pixels; never creates a far-only GPU owner. */
  public setSize(width: number, height: number): void {
    if (
      this.disposed ||
      this.contextLost ||
      !this.backend ||
      (this.targetSize?.[0] === width && this.targetSize[1] === height)
    )
      return
    this.resetHistory()
    this.backend.setSize(width, height)
    this.targetSize = [width, height]
  }
  private release(): void {
    this.activationSeconds = 0
    this.activationSerial = null
    this.generation++
    this.abort?.abort()
    this.abort = null
    this.output = null
    this.plan = null
    this.stats.effectiveWeight = 0
    // Clear borrowed output handles before their owning targets are destroyed.
    this.useEndpoint(null, null)
    this.backend?.dispose()
    this.backend = null
    this.targetSize = null
    this.prepared?.dispose()
    this.prepared = null
    this.key = ''
    this.failedLayout = null
    this.history = null
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
    if (this.contextLost) {
      this.stats.state = 'context-lost'
      return this.fallback('context-lost')
    }
    this.output = null
    this.plan = null
    this.stats.effectiveWeight = 0
    this.stats.requestedWeight = 0
    const bodies = this.registry.entries()
    const farFallbacks: Array<{ actorId: number; reason: 'resources' }> = []
    this.stats.farFallbacks = farFallbacks
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
      const sceneLight = this.registry
        .receivers(body.actorId)
        .find((receiver) => receiver.getLightSettings)
        ?.getLightSettings?.()
      const frame = captureCloudFrame(body, camera, viewport, serial, deltaSeconds, sceneLight)
      this.frames.set(body.actorId, frame)
      const map = this.enabled ? body.descriptor.far : null
      const source = map ? (owner.sources.read(map.pattern.map.resourceId)?.texture ?? null) : null
      const color =
        map?.pattern.encoding !== 'rgb-cloud-map' && map?.color.kind === 'map'
          ? map.color.map.resourceId === map.pattern.map.resourceId
            ? source
            : (owner.sources.read(map.color.map.resourceId)?.texture ?? null)
          : null
      const requiresColor = map?.pattern.encoding !== 'rgb-cloud-map' && map?.color.kind === 'map'
      if (map && (!source || (requiresColor && !color)))
        farFallbacks.push({ actorId: body.actorId, reason: 'resources' })
      for (const receiver of this.registry.receivers(body.actorId)) {
        receiver.setFarMap(map, source, color)
        receiver.setEndpoint(frame, null)
      }
    }
    if (!this.enabled) {
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
            (s) =>
              s.entry.bodyActorId === body.actorId &&
              s.entry.ready &&
              s.generation === s.entry.generation &&
              (!this.lostAtmospheres.has(s.entry) || this.lostAtmospheres.get(s.entry) !== s.generation)
          )
        : undefined
    if (!frame || !slot || lensActive || atmosphereDebugView) {
      this.release()
      this.stats.state = 'waiting'
      return this.fallback(lensActive ? 'lens' : atmosphereDebugView ? 'debug-view' : 'atmosphere')
    }
    const config = body.descriptor.volume!
    this.atmosphereGenerations.set(slot.entry, slot.generation)
    this.lostAtmospheres.delete(slot.entry)
    const candidate = candidates.find((c) => c.actorId === id)!
    const weight = cloudVolumeOpacity(candidate.shellDistanceMeters, config.lod)
    this.stats.requestedWeight = weight
    const key = JSON.stringify([body.descriptor, this.quality, slot.entry.actorId, slot.generation])
    // Retry signatures include receiver shader sources; only build them for a latched failure.
    if (
      this.compilationFailures.current &&
      !this.compilationFailures.retry(
        this.retryBoundary(key),
        this.registry.entries().flatMap((entry) => this.registry.receivers(entry.actorId))
      )
    ) {
      this.stats.state = 'error'
      return this.fallback('error')
    }
    if (this.stats.state === 'error' && this.failedLayout !== null && this.failedLayout !== this.receiverLayout()) {
      this.release()
      this.stats.state = 'waiting'
    }
    if (key !== this.key) {
      this.release()
      this.key = key
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
    this.bindRenderer(renderer)
    if (this.compilationFailures.current?.recovery === 'context') return null
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
      this.targetSize = [plan.frame.viewport.x, plan.frame.viewport.y]
      const nextHistory: CloudHistoryStamp = {
        actorId: plan.frame.actorId,
        scenarioEpoch: this.scenarioEpoch,
        sourceGeneration: this.generation,
        atmosphereGeneration: plan.atmosphere.generation,
        quality: this.quality,
        viewport: [plan.frame.viewport.x, plan.frame.viewport.y],
        projection: plan.frame.camera.projectionMatrix.elements.slice(),
        cameraPositionMeters: plan.frame.camera.position.clone(),
        cameraRotation: plan.frame.camera.quaternion.clone(),
        cutoffDistanceMeters: this.selected.descriptor.volume!.lod.cutoffDistanceMeters,
        explicitDiscontinuity: this.discontinuity
      }
      if (this.history && shouldResetCloudHistory(this.history, nextHistory)) backend.resetHistory()
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
      this.history = nextHistory
      this.stats.state = 'ready'
      this.failure = null
      return output
    } catch (error) {
      this.invalidate('error', error)
      return null
    }
  }
  public prepareVolume(renderer: WebGLRenderer, input: WebGLRenderTarget, plan: CloudFramePlan): boolean {
    if (plan !== this.plan || !this.prepared || !this.selected) return false
    try {
      this.backend ??= this.deps.createBackend(
        plan.frame,
        plan.atmosphere,
        this.prepared,
        this.selected.descriptor.qualityProfile,
        this.quality
      )
      if (!this.backend.prepare(renderer, input)) {
        this.deferVolume(plan)
        return false
      }
      return true
    } catch (error) {
      this.invalidate('error', error)
      return false
    }
  }
  public deferVolume(plan: CloudFramePlan): null {
    if (plan === this.plan) {
      this.stats.state = 'warming'
      this.stats.reason = 'preparing'
    }
    return null
  }
  /** Compilation may borrow near materials before any cloud texture is publishable. */
  public getPreparationMaterialBindings(plan: CloudFramePlan): ReadonlyMap<ShaderMaterial, ShaderMaterial> {
    if (plan !== this.plan || !this.prepared || this.selected?.actorId !== plan.frame.actorId)
      throw new Error('Cloud compilation requires the current prepared plan')
    return new Map(
      this.registry
        .receivers(plan.frame.actorId)
        .map((receiver) => [
          receiver.getEndpointMaterial('far'),
          receiver.getEndpointMaterial('near', this.backend?.shadowCascadeCount)
        ])
    )
  }
  public useEndpoint(plan: CloudFramePlan | null, output: SceneCloudOutput | null, activate = true): void {
    const valid =
      !this.compilationFailures.current &&
      plan !== null &&
      plan === this.plan &&
      output !== null &&
      output === this.output
    if (valid && activate) {
      if (this.activationSerial !== plan.frame.serial) {
        const delta = Number.isFinite(plan.frame.deltaSeconds)
          ? Math.max(0, Math.min(0.05, plan.frame.deltaSeconds))
          : 0
        this.activationSeconds = Math.min(0.6, this.activationSeconds + delta)
        this.activationSerial = plan.frame.serial
      }
      const t = this.activationSeconds / 0.6
      this.stats.effectiveWeight = plan.requestedWeight * t * t * (3 - 2 * t)
    } else if (plan) this.stats.effectiveWeight = 0
    if (valid && activate) this.stats.state = 'active'
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
  private retryBoundary(key = this.key): string {
    return JSON.stringify([key, this.generation, this.receiverLayout()])
  }
  public getEndpointMaterials(plan: CloudFramePlan): {
    bindings: ReadonlyMap<ShaderMaterial, ShaderMaterial>
    owners: ReadonlyMap<ShaderMaterial, SceneCloudReceiver>
  } {
    if (
      this.compilationFailures.current ||
      plan !== this.plan ||
      this.output?.frame !== plan.frame ||
      this.selected?.actorId !== plan.frame.actorId
    )
      throw new Error('Near materials require the accepted current cloud output')
    const bindings = new Map<ShaderMaterial, ShaderMaterial>(),
      owners = new Map<ShaderMaterial, SceneCloudReceiver>()
    // Acquisition refreshes live material state. Share it with draw attribution.
    for (const receiver of this.registry.receivers(this.selected.actorId)) {
      const far = receiver.getEndpointMaterial('far'),
        near = receiver.getEndpointMaterial('near')
      bindings.set(far, near)
      owners.set(near, receiver)
    }
    return { bindings, owners }
  }
  public invalidate(reason: CloudFallbackReason, cause?: unknown, compilation?: CloudCompilationEvidence): void {
    this.activationSeconds = 0
    this.activationSerial = null
    const original =
      this.compilationFailures.current?.cause ??
      (compilation && this.stats.state === 'error' && this.failure !== null ? this.failure : cause)
    if (compilation) this.compilationFailures.record(original, compilation, this.retryBoundary())
    this.failure = original ?? null
    this.output = null
    this.plan = null
    this.stats.effectiveWeight = 0
    this.stats.reason = reason
    this.stats.state = reason === 'context-lost' ? 'context-lost' : 'error'
    this.failedLayout = this.receiverLayout()
    this.useEndpoint(null, null)
  }
  public recordPasses(counts: Partial<CloudPassCounts>): void {
    for (const [key, value] of Object.entries(counts)) this.stats[key as keyof CloudPassCounts] += value
  }
  public get diagnostics(): Readonly<CloudDiagnostics> {
    return { ...this.stats, farFallbacks: this.stats.farFallbacks.map((entry) => ({ ...entry })) }
  }
  public get error(): unknown {
    return this.compilationFailures.current?.cause ?? this.failure
  }
  public dispose(): void {
    if (this.disposed) return
    this.compilationFailures.dispose()
    this.resetScenario()
    this.disposed = true
    this.stop()
    for (const { sources } of this.sources.values()) sources.dispose()
    this.sources.clear()
    this.frames.clear()
  }
}
