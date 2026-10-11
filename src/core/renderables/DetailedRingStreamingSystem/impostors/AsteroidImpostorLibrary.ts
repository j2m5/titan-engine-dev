import type { Texture, WebGLRenderer } from 'three'
import type { AsteroidImpostorSettings } from '@/config/asteroidImpostor'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { ShapeModelStorage } from '../archetypes/ShapeModelStorage'
import { shapeModelGeometry } from '../archetypes/ShapeModelFormat'
import { createImpostorLayout } from './impostorLayout'
import { atlasBytes, ImpostorBudget, type ImpostorBudgetSnapshot } from './impostorBudget'
import { checkImpostorCapabilities, createImpostorAtlas, impostorScratchBytes } from './impostorResources'
import { AsteroidImpostorBaker } from './AsteroidImpostorBaker'
import { AsteroidSurfaceAverages } from './AsteroidSurfaceAverages'
import { geometryBytes, geometryRadius, initialImpostorRevisions, ImpostorPhysicalSources, impostorSourceKey } from './impostorSources'
import { ImpostorQueue } from './impostorQueue'
import { checkedImpostorGpu } from './impostorGpuCheck'
import { createImpostorWarmup, IMPOSTOR_WARMUP_BYTES, type ImpostorMaterialVariant } from './impostorWarmup'
import type { AsteroidSurfaceAverageValues, ImpostorAtlas, ImpostorBakerPort, ImpostorConsumer, ImpostorLease,
  ImpostorRevision, ImpostorSnapshot, ImpostorSourceDescriptor, PreparedImpostorUpdate } from './impostorTypes'

export interface ImpostorLibraryHooks {
  now?: () => number
  yieldToUi?: () => Promise<void>
  makeBaker?: (renderer: WebGLRenderer) => ImpostorBakerPort
}

export interface ImpostorLibraryStats extends ImpostorBudgetSnapshot {
  libraries: number
  readySlots: number
  queuedJobs: number
  cpuBytes: number
  prepareMs: number
  fallbackReasons: readonly string[]
}

interface LeaseState {
  allowed: boolean
  attributes: boolean
  snapshot: ImpostorSnapshot
  released: boolean
  consumers: Set<ImpostorConsumer>
  reason: string | null
  instanceBytes: number
}

interface LibraryEntry {
  key: string
  source: ImpostorSourceDescriptor
  generation: number
  leases: Set<LeaseState>
  latest: ImpostorRevision[]
  initial: ImpostorRevision[]
  baked: (ImpostorRevision | undefined)[]
  halfExtents: Float32Array
  atlas: ImpostorAtlas | null
  snapshot: ImpostorSnapshot
  allowed: boolean
  spare: number
  reason: string | null
  restoring: boolean
  pendingCapabilities: boolean
}

interface PageJob {
  key: string
  entry: LibraryEntry
  scene: number
  generation: number
  revision: ImpostorRevision
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)
const yieldToUi = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** Один baker и бюджет на сцену; публикация происходит только между кадрами. */
export class AsteroidImpostorLibrary {
  private readonly layout
  private readonly budget: ImpostorBudget
  private readonly settingsError: string | null
  private readonly physical: ImpostorPhysicalSources
  private readonly averages: AsteroidSurfaceAverages
  private readonly entries = new Map<string, LibraryEntry>()
  private readonly queue = new ImpostorQueue<PageJob>()
  private readonly scratchOwner = {}
  private readonly temporaryOwner = {}
  private readonly averageOwner = {}
  private readonly averageJobs = new Set<Promise<AsteroidSurfaceAverageValues>>()
  private readonly recoveryWaiters = new Set<{ resume: () => void; reject: (error: Error) => void }>()
  private readonly warmups = new Map<string, { run: () => Promise<void>; release: () => void; invalidate?: () => void; done: boolean; entries: Set<LibraryEntry>; all: boolean }>()
  private readonly diagnostics = new Set<string>()
  private readonly legacyUpdates = new Set<LibraryEntry>()
  private readonly now: () => number
  private readonly yieldToUi: () => Promise<void>
  private sceneGeneration = 0
  private active: PageJob | null = null
  private baker: ImpostorBakerPort | null = null
  private samples = 0
  private scratchReserved = false
  private prepareMs = 0
  private gpuGeneration = 0
  private lost = false
  private preparation: Promise<void> | null = null
  private readonly deferredCleanup: (() => void)[] = []

  constructor(private readonly renderer: WebGLRenderer, private readonly settings: AsteroidImpostorSettings,
    private readonly shapeModels: ShapeModelStorage, private readonly progress?: LoadingProgressReporter,
    private readonly hooks: ImpostorLibraryHooks = {}) {
    let layout = createImpostorLayout(8, 64), settingsError: string | null = null
    const bytes = Math.floor(settings.budgetMiB * 1024 * 1024)
    try {
      layout = createImpostorLayout(settings.gridSize, settings.frameSize)
      if (!Number.isSafeInteger(bytes) || bytes < 0 ||
        ![settings.loadViewsPerChunk, settings.frameViewsPerChunk, settings.bakeVersion].every(value => Number.isSafeInteger(value) && value > 0) ||
        !(settings.chunkCpuMs > 0 && Number.isFinite(settings.chunkCpuMs)) ||
        !(settings.detailStartFraction >= 0 && settings.detailStartFraction < 1)) throw new RangeError('Неверные настройки импосторов')
    } catch (error) { settingsError = `Настройки импосторов: ${messageOf(error)}` }
    this.layout = layout
    this.settingsError = settingsError
    this.budget = new ImpostorBudget(Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : 0)
    this.physical = new ImpostorPhysicalSources(this.budget, action => this.releaseGpu(action))
    this.averages = new AsteroidSurfaceAverages(renderer, bytes => {
      if (!this.budget.reserve(this.averageOwner, bytes)) return false
      this.budget.commit(this.averageOwner)
      return true
    }, () => this.budget.release(this.averageOwner), action => this.releaseGpu(action))
    this.now = hooks.now ?? (() => performance.now())
    this.yieldToUi = hooks.yieldToUi ?? yieldToUi
    renderer.domElement?.addEventListener?.('webglcontextlost', this.onContextLost)
    renderer.domElement?.addEventListener?.('webglcontextrestored', this.onContextRestored)
  }

  acquire(source: ImpostorSourceDescriptor, instanceBytes: number): ImpostorLease {
    const key = impostorSourceKey(source, this.layout)
    let entry = this.entries.get(key)
    if (!entry) {
      const latest = initialImpostorRevisions(source)
      entry = { key, source, generation: 0, leases: new Set(), latest, initial: latest, baked: new Array(source.count),
        halfExtents: new Float32Array(source.count), atlas: null, snapshot: this.legacy(latest, null),
        allowed: false, spare: source.count, reason: null, restoring: false, pendingCapabilities: false }
      this.entries.set(key, entry)
      const unavailable = this.isLost()
      const pending = this.settings.enabled && !this.settingsError && unavailable
      const capability = pending ? { supported: true, samples: this.samples, reason: null }
        : this.settings.enabled && !this.settingsError && !unavailable ? checkImpostorCapabilities(this.renderer, this.layout, source.count)
        : { supported: false, samples: 0, reason: this.settingsError ?? (unavailable ? 'Контекст WebGL потерян' : 'Импосторы выключены') }
      this.samples = capability.samples
      if (!capability.supported) entry.reason = capability.reason
      else if (pending) {
        entry.allowed = true
        entry.pendingCapabilities = true
        entry.reason = 'Контекст WebGL потерян'
      }
      else if (!this.reserveScratch() || !this.budget.reserve(entry, atlasBytes(this.layout, source.count))) entry.reason = 'Бюджет атласа исчерпан'
      else {
        entry.allowed = true
        for (const revision of latest) this.enqueue(entry, revision)
      }
      entry.snapshot = this.legacy(latest, entry.reason)
      if (entry.reason) this.diagnostics.add(entry.reason)
      this.requestModels(entry)
    } else if (entry.allowed && !this.isLost() && entry.snapshot.state === 'ready') {
      for (const revision of entry.latest) {
        if (revision.version > entry.snapshot.revisions[revision.slot].version &&
          !(this.active?.entry === entry && this.active.revision === revision)) this.enqueue(entry, revision)
      }
    }
    const current = entry, scene = this.sceneGeneration
    const state: LeaseState = { allowed: current.allowed, attributes: false, snapshot: current.snapshot,
      released: false, consumers: new Set(), reason: current.reason, instanceBytes }
    if (state.allowed && !this.isLost() && !this.budget.reserve(state, instanceBytes)) {
      state.allowed = false
      state.reason = 'Бюджет instance-атрибутов исчерпан'
      this.diagnostics.add(state.reason)
    } else if (state.allowed && !this.isLost()) this.budget.commit(state)
    state.attributes = state.allowed
    if (!state.allowed) state.snapshot = this.legacy(current.snapshot.revisions, state.reason)
    current.leases.add(state)
    const valid = (): boolean => !state.released && scene === this.sceneGeneration && this.entries.get(key) === current
    return {
      current: () => valid() ? state.snapshot : this.legacy([], 'Аренда завершена'),
      allowsAtlas: () => state.allowed,
      useProceduralFallback: reason => {
        if (!valid()) return this.legacy([], 'Аренда завершена')
        if (!this.isLost()) state.allowed = false
        state.reason = reason
        this.diagnostics.add(reason)
        return state.snapshot = this.legacy(current.initial, reason)
      },
      acquireGeometry: (revision, radius) => valid() && (!this.isLost() || revision.version === 0) ? this.physical.acquire(key, source, revision, radius) : null,
      prepareSurfaceAverages: (diffuse, arm) => this.prepareAverages(diffuse, arm),
      subscribe: consumer => {
        if (valid()) state.consumers.add(consumer)
        return () => { state.consumers.delete(consumer) }
      },
      release: () => {
        if (state.released) return
        state.released = true
        state.consumers.clear()
        this.budget.release(state)
        current.leases.delete(state)
        if (!current.leases.size && this.entries.get(key) === current) this.remove(current)
      }
    }
  }

  private legacy(revisions: readonly ImpostorRevision[], reason: string | null): ImpostorSnapshot {
    return { generation: this.sceneGeneration, state: 'legacy', atlas: null,
      slotLayers: new Int32Array(), halfExtents: new Float32Array(), revisions, reason }
  }

  private reserveScratch(): boolean {
    if (this.scratchReserved) return true
    this.scratchReserved = this.budget.reserve(this.scratchOwner, impostorScratchBytes(this.layout, this.samples))
    return this.scratchReserved
  }

  private prepareAverages(diffuse: Texture, arm: Texture): Promise<AsteroidSurfaceAverageValues> {
    const generation = this.sceneGeneration
    const pending = (async (): Promise<AsteroidSurfaceAverageValues> => {
      while (generation === this.sceneGeneration) {
        if (this.isLost()) await new Promise<void>((resume, reject) => this.recoveryWaiters.add({ resume, reject }))
        if (generation !== this.sceneGeneration) break
        try { return await this.averages.prepare(diffuse, arm) }
        catch (error) { if (!this.isLost()) throw error }
      }
      throw new Error('Подготовка поверхности отменена')
    })()
    this.averageJobs.add(pending)
    void pending.then(() => this.averageJobs.delete(pending), () => this.averageJobs.delete(pending))
    return pending
  }

  private enqueue(entry: LibraryEntry, revision: ImpostorRevision): void {
    this.queue.enqueue({ key: `${entry.key}:${revision.slot}`, entry, revision, scene: this.sceneGeneration, generation: entry.generation })
  }

  private requestModels(entry: LibraryEntry): void {
    const generation = this.sceneGeneration
    const firstSlot = entry.source.count - entry.source.realModels.length
    entry.source.realModels.forEach((name, index) => {
      void Promise.all([this.shapeModels.load(name, 'l0'), this.shapeModels.load(name, 'near')]).then(([l0, near]) => {
        if (!l0 || !near || generation !== this.sceneGeneration || this.entries.get(entry.key) !== entry) return
        const slot = firstSlot + index
        const geometry = shapeModelGeometry(l0, 1), nearGeometry = shapeModelGeometry(near, 1)
        const revision = { slot, version: entry.latest[slot].version + 1, l0: geometry, near: nearGeometry, boundRadius: geometryRadius(geometry) }
        entry.latest = entry.latest.slice()
        entry.latest[slot] = revision
        if (entry.allowed && !this.isLost()) this.enqueue(entry, revision)
        this.legacyUpdates.add(entry)
      }).catch(error => {
        if (generation === this.sceneGeneration && this.entries.get(entry.key) === entry) this.diagnostics.add(messageOf(error))
      })
    })
  }

  private flushLegacyUpdates(): void {
    for (const entry of this.legacyUpdates) {
      if (this.entries.get(entry.key) !== entry) continue
      try {
        if (!entry.allowed) this.publish(entry, this.legacy(entry.latest, entry.reason))
        else for (const lease of entry.leases) if (!lease.allowed) {
          const next = this.legacy(entry.latest, lease.reason), prepared = this.prepareLease(lease, next)
          lease.snapshot = next
          for (const update of prepared) update.commit()
          for (const update of prepared) update.dispose()
        }
      } catch (error) { this.diagnostics.add(messageOf(error)) }
    }
    this.legacyUpdates.clear()
  }

  registerWarmup(key: string, warmup: () => Promise<void>, release: () => void, source?: ImpostorSourceDescriptor, invalidate?: () => void): void {
    const entry = source ? this.entries.get(impostorSourceKey(source, this.layout)) : undefined
    const existing = this.warmups.get(key)
    if (existing) { if (entry) existing.entries.add(entry); release(); return }
    const record = { run: warmup, release, invalidate, done: false, entries: new Set(entry ? [entry] : []), all: source === undefined }
    if (!this.isLost() && !this.budget.reserve(record, IMPOSTOR_WARMUP_BYTES)) {
      release()
      if (entry) this.failInitial(entry, 'Бюджет прогрева импосторов исчерпан')
      return
    }
    this.warmups.set(key, record)
  }

  registerMaterialVariant(source: ImpostorSourceDescriptor, variant: ImpostorMaterialVariant): void {
    let resources: ReturnType<typeof createImpostorWarmup> | null = null
    this.registerWarmup(JSON.stringify([variant.ice, variant.cascade, variant.lightTint]), async () => {
      resources ??= createImpostorWarmup(this.renderer, variant)
      await resources.run()
    }, () => { resources?.dispose(); resources = null }, source, () => resources?.invalidateGpu())
  }

  prepareInitial(): Promise<void> {
    if (this.isLost()) return Promise.resolve()
    if (this.preparation) return this.preparation
    const pending = this.prepare().finally(() => { if (this.preparation === pending) this.preparation = null })
    this.preparation = pending
    return pending
  }

  private async prepare(): Promise<void> {
    const generation = this.sceneGeneration, gpu = this.gpuGeneration, boundary = this.queue.watermark, started = this.now()
    const valid = (): boolean => generation === this.sceneGeneration && gpu === this.gpuGeneration && !this.isLost()
    const total = this.queue.size + Number(this.active !== null) + this.warmups.size
    this.progress?.setAsset('Подготовка астероидов')
    this.progress?.setTotal(total)
    this.progress?.setProgress(0)
    await Promise.allSettled([...this.averageJobs])
    if (!valid()) return
    this.flushLegacyUpdates()
    for (const warmup of [...this.warmups.values()]) {
      if (warmup.done) continue
      try {
        await warmup.run()
        if (!valid()) return
        warmup.done = true
        this.budget.commit(warmup)
      }
      catch (error) {
        if (!valid()) return
        for (const entry of warmup.all ? this.entries.values() : warmup.entries) {
          if (entry.allowed) this.failInitial(entry, messageOf(error))
        }
      }
      if (!valid()) return
      await this.yieldToUi()
    }
    while (valid() && (this.active || this.queue.has(boundary))) {
      this.pump(this.settings.loadViewsPerChunk, boundary)
      this.progress?.setProgress(Math.max(0, total - this.queue.size - Number(this.active !== null)))
      await this.yieldToUi()
    }
    if (valid()) {
      this.prepareMs = this.now() - started
      this.progress?.setProgress(total)
    }
  }

  pumpFrame(): void { if (!this.preparation) this.pump(this.settings.frameViewsPerChunk) }

  private valid(job: PageJob): boolean {
    return job.scene === this.sceneGeneration && job.generation === job.entry.generation && this.entries.get(job.entry.key) === job.entry && job.entry.allowed
  }

  private pump(maxViews: number, boundary = Infinity): void {
    if (this.isLost()) { this.onContextLost(); return }
    this.flushLegacyUpdates()
    let job = this.active
    try {
      if (!job) {
        do { job = this.queue.shift(boundary) } while (job && !this.valid(job))
        if (!job) return
        this.active = job
        const entry = job.entry
        if (!entry.atlas) {
          checkedImpostorGpu(this.renderer, () => { entry.atlas = createImpostorAtlas(this.renderer, this.layout, entry.source.count) })
          this.budget.commit(entry)
        }
        if (!this.baker) {
          checkedImpostorGpu(this.renderer, () => { this.baker = this.hooks.makeBaker?.(this.renderer) ?? new AsteroidImpostorBaker(this.renderer, this.layout, this.samples) })
          this.budget.commit(this.scratchOwner)
        }
        if (!this.budget.reserve(this.temporaryOwner, geometryBytes(job.revision.l0))) throw new Error('Бюджет временной формы исчерпан')
        this.budget.commit(this.temporaryOwner)
        this.baker!.begin(job.revision.l0, entry.atlas!, entry.snapshot.state === 'ready' ? entry.spare : job.revision.slot)
      }
      if (!this.valid(job)) { this.cancelActive(); return }
      if (checkedImpostorGpu(this.renderer, () => this.baker!.step(maxViews, this.settings.chunkCpuMs)) === 'pending') return
      if (this.isLost()) { this.onContextLost(); return }
      const result = this.baker!.finish()
      this.active = null
      this.budget.release(this.temporaryOwner)
      if (!this.valid(job)) return
      const entry = job.entry, revision = { ...job.revision, boundRadius: result.boundRadius }
      if (entry.snapshot.state === 'ready') {
        const layers = entry.snapshot.slotLayers.slice(), halfExtents = entry.snapshot.halfExtents.slice(), revisions = entry.snapshot.revisions.slice()
        const previous = layers[revision.slot]
        layers[revision.slot] = entry.spare
        halfExtents[revision.slot] = result.halfExtent
        revisions[revision.slot] = revision
        this.publish(entry, { ...entry.snapshot, slotLayers: layers, halfExtents, revisions })
        entry.spare = previous
      } else {
        entry.baked[revision.slot] = revision
        entry.halfExtents[revision.slot] = result.halfExtent
        if (entry.baked.filter(Boolean).length === entry.source.count) {
          this.publish(entry, { generation: this.sceneGeneration, state: 'ready', atlas: entry.atlas,
            slotLayers: Int32Array.from({ length: entry.source.count }, (_, i) => i), halfExtents: entry.halfExtents.slice(),
            revisions: entry.baked as ImpostorRevision[], reason: null })
          if (entry.restoring) {
            entry.restoring = false
            for (const latest of entry.latest) if (latest.version > entry.snapshot.revisions[latest.slot].version) this.enqueue(entry, latest)
          }
        }
      }
    } catch (error) {
      if (this.isLost()) { this.onContextLost(); return }
      this.cancelActive()
      if (job) {
        if (job.entry.snapshot.state === 'ready') this.diagnostics.add(messageOf(error))
        else this.failInitial(job.entry, messageOf(error))
      }
    }
  }

  private publish(entry: LibraryEntry, next: ImpostorSnapshot): void {
    const prepared: PreparedImpostorUpdate[] = []
    const snapshots = new Map<LeaseState, ImpostorSnapshot>()
    try {
      for (const lease of entry.leases) {
        const snapshot = lease.allowed ? next : this.legacy(next.revisions, lease.reason ?? next.reason)
        try {
          prepared.push(...this.prepareLease(lease, snapshot))
          snapshots.set(lease, snapshot)
        } catch (error) {
          if (lease.allowed) throw error
          this.diagnostics.add(messageOf(error))
        }
      }
    } catch (error) { for (const update of prepared) update.dispose(); throw error }
    entry.snapshot = next
    for (const [lease, snapshot] of snapshots) lease.snapshot = snapshot
    for (const update of prepared) update.commit()
    for (const update of prepared) update.dispose()
  }

  private prepareLease(lease: LeaseState, next: ImpostorSnapshot): PreparedImpostorUpdate[] {
    const prepared: PreparedImpostorUpdate[] = []
    try { for (const consumer of lease.consumers) prepared.push(consumer.prepare(next)) }
    catch (error) { for (const update of prepared) update.dispose(); throw error }
    return prepared
  }

  private cancelActive(): void {
    if (this.active) this.baker?.cancel()
    this.active = null
    this.budget.release(this.temporaryOwner)
  }

  private failInitial(entry: LibraryEntry, reason: string): void {
    entry.generation++
    entry.reason = reason
    entry.allowed = false
    this.queue.remove(job => job.entry === entry)
    try { this.publish(entry, this.legacy(entry.latest, reason)) }
    catch (error) {
      this.diagnostics.add(messageOf(error))
      try { this.publish(entry, this.legacy(entry.snapshot.revisions, reason)) }
      catch (fallbackError) { this.diagnostics.add(messageOf(fallbackError)); return }
    }
    const atlas = entry.atlas
    if (atlas) this.releaseGpu(() => atlas.dispose())
    entry.atlas = null
    this.budget.release(entry)
    this.diagnostics.add(reason)
  }

  private remove(entry: LibraryEntry): void {
    entry.generation++
    this.queue.remove(job => job.entry === entry)
    if (this.active?.entry === entry) this.cancelActive()
    const atlas = entry.atlas
    if (atlas) this.releaseGpu(() => atlas.dispose())
    this.budget.release(entry)
    this.entries.delete(entry.key)
    this.legacyUpdates.delete(entry)
  }

  stats(): ImpostorLibraryStats {
    const sources = new Set([...this.physical.geometries(), ...[...this.entries.values()].flatMap(entry =>
      [...entry.latest, ...entry.snapshot.revisions, ...entry.baked.filter((revision): revision is ImpostorRevision => !!revision)].flatMap(revision => [revision.l0, revision.near]))])
    return { ...this.budget.snapshot(), libraries: this.entries.size,
      readySlots: [...this.entries.values()].reduce((sum, entry) => sum + (entry.snapshot.state === 'ready' ? entry.snapshot.revisions.length : 0), 0),
      queuedJobs: this.queue.size + Number(this.active !== null), cpuBytes: [...sources].reduce((sum, source) => sum + geometryBytes(source), 0),
      prepareMs: this.prepareMs, fallbackReasons: [...this.diagnostics] }
  }

  clear(): void {
    this.sceneGeneration++
    for (const waiter of this.recoveryWaiters) waiter.reject(new Error('Подготовка поверхности отменена'))
    this.recoveryWaiters.clear()
    this.preparation = null
    if (this.isLost()) this.onContextLost()
    this.cancelActive()
    this.queue.clear()
    for (const entry of this.entries.values()) {
      for (const lease of entry.leases) { lease.released = true; lease.consumers.clear(); this.budget.release(lease) }
      const atlas = entry.atlas
      if (atlas) this.releaseGpu(() => atlas.dispose())
      this.budget.release(entry)
    }
    this.entries.clear()
    this.legacyUpdates.clear()
    this.physical.clear()
    const baker = this.baker
    if (baker) this.releaseGpu(() => baker.dispose())
    this.baker = null
    this.budget.release(this.scratchOwner)
    this.scratchReserved = false
    this.averages.clear()
    this.averageJobs.clear()
    for (const warmup of this.warmups.values()) { this.releaseGpu(warmup.release); this.budget.release(warmup) }
    this.warmups.clear()
    this.prepareMs = 0
    this.diagnostics.clear()
  }

  private isLost(): boolean { return this.lost || this.renderer.getContext().isContextLost() }

  private releaseGpu(action: () => void): void {
    if (this.isLost()) this.deferredCleanup.push(action)
    else action()
  }

  private readonly onContextLost = (event?: Event): void => {
    event?.preventDefault()
    if (this.lost) return
    this.lost = true
    this.gpuGeneration++
    this.preparation = null
    this.active = null
    this.queue.clear()
    this.legacyUpdates.clear()
    const baker = this.baker
    baker?.invalidateGpu?.()
    if (baker) this.releaseGpu(() => baker.dispose())
    this.baker = null
    this.scratchReserved = false
    for (const entry of this.entries.values()) {
      entry.generation++
      const atlas = entry.atlas
      atlas?.invalidateGpu?.()
      if (atlas) this.releaseGpu(() => atlas.dispose())
      entry.atlas = null
      entry.baked = new Array(entry.source.count)
      entry.snapshot = this.legacy(entry.snapshot.revisions, 'Контекст WebGL потерян')
      // Опубликованные формы остаются на месте; меняется только готовность атласа.
      for (const lease of entry.leases) for (const consumer of lease.consumers) {
        consumer.invalidateGpu?.()
        if (!lease.allowed) continue
        try { const update = consumer.prepare(entry.snapshot); update.commit(); update.dispose() }
        catch (error) { this.diagnostics.add(messageOf(error)) }
      }
      for (const lease of entry.leases) lease.snapshot = this.legacy(lease.snapshot.revisions, 'Контекст WebGL потерян')
    }
    for (const warmup of this.warmups.values()) {
      warmup.invalidate?.()
      this.releaseGpu(warmup.release)
      warmup.done = false
    }
    this.budget.invalidate()
  }

  private readonly onContextRestored = (): void => {
    if (!this.lost || this.renderer.getContext().isContextLost()) return
    this.lost = false
    for (const release of this.deferredCleanup.splice(0)) release()
    for (const waiter of this.recoveryWaiters) waiter.resume()
    this.recoveryWaiters.clear()
    if (!this.entries.size) return
    this.physical.restoreBudget()
    for (const entry of this.entries.values()) {
      if (entry.pendingCapabilities) {
        entry.pendingCapabilities = false
        const capability = checkImpostorCapabilities(this.renderer, this.layout, entry.source.count)
        if (!capability.supported) {
          const reason = capability.reason ?? 'Импосторы недоступны'
          for (const lease of entry.leases) this.rejectRestoration(lease, reason)
          this.failInitial(entry, reason)
        }
        else { this.samples = capability.samples; entry.reason = null }
      }
      for (const lease of entry.leases) if (lease.attributes) {
        if (!this.budget.reserve(lease, lease.instanceBytes)) {
          this.rejectRestoration(lease, 'Бюджет восстановления instance-атрибутов исчерпан')
          continue
        }
        this.budget.commit(lease)
      }
      if (!entry.allowed) continue
      if (!this.reserveScratch() || !this.budget.reserve(entry, atlasBytes(this.layout, entry.source.count))) {
        this.failInitial(entry, 'Бюджет восстановления атласа исчерпан')
        continue
      }
      entry.spare = entry.source.count
      entry.restoring = true
      for (const revision of entry.snapshot.revisions) this.enqueue(entry, revision)
    }
    for (const warmup of this.warmups.values()) {
      if (!this.budget.reserve(warmup, IMPOSTOR_WARMUP_BYTES)) {
        for (const entry of warmup.entries) this.failInitial(entry, 'Бюджет восстановления прогрева исчерпан')
      }
    }
    void this.prepareInitial().catch(error => this.diagnostics.add(messageOf(error)))
  }

  private rejectRestoration(lease: LeaseState, reason: string): void {
    lease.allowed = lease.attributes = false
    lease.reason = reason
    this.budget.release(lease)
    this.diagnostics.add(reason)
    for (const consumer of lease.consumers) consumer.rejectRestoration?.()
    const next = this.legacy(lease.snapshot.revisions, reason)
    try {
      const prepared = this.prepareLease(lease, next)
      lease.snapshot = next
      for (const update of prepared) update.commit()
      for (const update of prepared) update.dispose()
    } catch (error) { this.diagnostics.add(messageOf(error)) }
  }
}
