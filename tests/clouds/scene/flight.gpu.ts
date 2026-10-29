/** Actual Application/Engine acceptance path. The node runner boots the normal UI first.
 * Reflection is confined to this test module; no production debug surface is installed. */
import {
  Mesh,
  Quaternion,
  Vector2,
  Vector3,
  Scene,
  Raycaster,
  ShaderMaterial,
  WebGLRenderTarget,
  HalfFloatType,
  FloatType,
  PlaneGeometry,
  type PerspectiveCamera,
  type WebGLRenderer
} from 'three'
import { decodeSceneCloudDepth } from '@/core/clouds/scene/CloudFrame'
import type { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { engineStore } from '@/ui/mobx/EngineStore'
import { settingsStore } from '@/ui/mobx/SettingsStore'
import { Scenarios } from '@/config/scenarios'
import { SpaceScale } from '@/core/constants'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { CloudBodyEntry, CloudRegistry } from '@/core/services/CloudRegistry'
import type { CameraController } from '@/core/camera/CameraController'
import type { CameraCollision } from '@/core/services/CameraCollision'
import type { SimulationClock } from '@/core/time/SimulationClock'
import type { Postprocessing } from '@/core/graphic/Postprocessing'
import type { CloudDiagnostics, CloudFramePlan } from '@/core/clouds/SceneCloudRuntime'
import { getSceneCloudFlightScope, type SceneCloudProbeReport } from './probe'

type Pose = { camera: number[]; quaternion: number[]; body?: string; label?: string }
type Baseline = {
  terrain: {
    pose: Pose
    sample: {
      p50: number
      p95: number
      gpu: string
      userAgent: string
      viewport: number[]
      dpr: number
      rendererPixelRatio: number
      memory: unknown
      programs: number
    }
  }
}
type EngineAccess = {
  scene: Scene
  renderCamera: PerspectiveCamera
  renderer: WebGLRenderer
  camera: CameraController
  cameraCollision: CameraCollision
  clock: SimulationClock
  postprocessing: Postprocessing
  renderFrame(): void
  sceneManager: { factory: { cloudRegistry: CloudRegistry } }
}
type FlightWindow = Window & {
  __sceneCloudFlightBaseline?: Baseline | null
  __sceneCloudFlightStart?: string
  __sceneCloudFlightCheckpoint?: { id: string; data: unknown; acknowledge(): void }
  __sceneCloudFlightEvidence?: unknown
}
const host = window as FlightWindow
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
const privateField = <T>(owner: object, name: string): T => Reflect.get(owner, name) as T

export async function run(): Promise<SceneCloudProbeReport> {
  if (!import.meta.env.DEV) throw new Error('Flight access requires a development/test server')
  const app = privateField<{
    engine: EngineAccess
    resourceObserver: { inFlight: Set<string>; pendingUpgrades?: Map<string, unknown> }
  }>(engineStore, 'app')
  const e = app?.engine
  if (!e || engineStore.scenario?.id !== 1 || engineStore.appLoadingStatus || !document.querySelector('#canvas'))
    throw new Error('Flight requires the production Solar UI boot; a blank fixture is not an app')
  const baseline = host.__sceneCloudFlightBaseline ?? null
  const runtime = e.postprocessing.cloudRuntime!
  if (!runtime) throw new Error('Production cloud runtime absent')
  const registry = e.sceneManager.factory.cloudRegistry
  const scope = getSceneCloudFlightScope(host.__sceneCloudFlightStart).start
  const cases: string[] = []
  const phases: unknown[] = [],
    performanceStates: unknown[] = [],
    exits: unknown[] = [],
    activationEvents: unknown[] = [],
    readiness: unknown[] = []
  const sourceNotifications: unknown[] = []
  const evidence = {
    started: new Date().toISOString(),
    scope,
    reference: baseline ? 'saved-terrain-pose' : 'current-epoch-subsolar-70km',
    environment: {} as unknown,
    phases,
    performanceStates,
    exits,
    activationEvents,
    readiness,
    sourceNotifications,
    endpointReferences: [] as unknown[],
    currentReadiness: null as unknown,
    limits: [
      'RAF intervals and renderer object counts are not GPU time or bytes.',
      ...(baseline
        ? [
            'Saved baseline autoReset=true render calls cover only the latest composer pass; current counters cover a whole Engine frame.'
          ]
        : ['Standalone flight has no historical performance baseline; its timings describe the current run only.'])
    ]
  }
  host.__sceneCloudFlightEvidence = evidence
  let checks = 0,
    simulationTicks = 0,
    lastTickDelta = 0,
    maxError = 0
  let gpuMeasurementActive = false
  let gpuTiming: {
    gl: WebGL2RenderingContext
    extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
    pending: WebGLQuery[]
    durationsMs: number[]
    disjoint: boolean
  } | null = null
  let lastPlan: CloudFramePlan | null = null
  let lastFrame = {
    ticks: 0,
    passes: runtime.diagnostics,
    render: { calls: 0, triangles: 0, points: 0, lines: 0 },
    durationMs: 0
  }
  const assert = (condition: unknown, message: string) => {
    checks++
    if (!condition) throw new Error(`Flight: ${message}`)
  }
  const phase = (name: string) =>
    console.log('SCENE_CLOUD_FLIGHT_PHASE', JSON.stringify({ name, at: new Date().toISOString() }))
  const originalAdvance = e.clock.advance
  const originalFrame = e.renderFrame
  const originalBegin = runtime.beginFrame
  const originalRender = e.postprocessing.render
  const originalDraw = e.renderer.render
  let renderBreakdown: Record<string, { invocations: number; calls: number; triangles: number }> = {}
  let captureDeltas: number[] | null = null
  let functionalCapture: (() => void) | null = null
  const originalAutoReset = e.renderer.info.autoReset
  e.clock.advance = function (delta) {
    simulationTicks++
    lastTickDelta = delta
    return originalAdvance.call(this, delta)
  }
  e.postprocessing.render = function (delta) {
    captureDeltas?.push(delta ?? NaN)
    return originalRender.call(this, delta)
  }
  e.renderer.render = function (scene, camera) {
    const composition = privateField<object | null>(e.postprocessing, 'composition')
    const depth = composition && privateField<object | null>(composition, 'depth')
    const near =
      composition &&
      privateField<{ composer: { inputBuffer: WebGLRenderTarget; outputBuffer: WebGLRenderTarget } } | null>(
        composition,
        'near'
      )
    const target = this.getRenderTarget()
    let label = target ? target.texture.name || 'volume-shadow-other' : 'screen'
    if (depth && target === privateField(depth, 'opaque')) label = 'opaque-depth'
    else if (depth && target === privateField(depth, 'water')) label = 'water-depth'
    else if (depth && target === privateField(depth, 'resolved')) label = 'merged-depth'
    else if (near && [near.composer.inputBuffer, near.composer.outputBuffer].includes(target!)) label = 'near-HDR'
    else if (
      e.postprocessing.composer &&
      [e.postprocessing.composer.inputBuffer, e.postprocessing.composer.outputBuffer].includes(target!)
    )
      label = 'far-final-HDR'
    const before = { ...this.info.render }
    originalDraw.call(this, scene, camera)
    const counts = (renderBreakdown[label] ??= { invocations: 0, calls: 0, triangles: 0 })
    counts.invocations++
    counts.calls += this.info.render.calls - before.calls
    counts.triangles += this.info.render.triangles - before.triangles
  }
  let forceFarReference = false
  runtime.beginFrame = function (...args) {
    lastPlan = originalBegin.apply(this, args)
    return forceFarReference ? null : lastPlan
  }
  const difference = (after: CloudDiagnostics, before: CloudDiagnostics) =>
    Object.fromEntries(
      (['depthPasses', 'cloudUpdates', 'shadowUpdates', 'farRenders', 'nearRenders', 'finalRenders'] as const).map(
        (key) => [key, after[key] - before[key]]
      )
    )
  e.renderer.info.autoReset = false
  e.renderFrame = function () {
    e.renderer.info.reset()
    renderBreakdown = {}
    const before = simulationTicks,
      started = performance.now(),
      stateBefore = runtime.diagnostics
    const backendBefore = !!privateField(runtime, 'backend')
    const timing = gpuTiming
    const query = gpuMeasurementActive && timing ? timing.gl.createQuery() : null
    if (query && timing) timing.gl.beginQuery(timing.extension.TIME_ELAPSED_EXT, query)
    try {
      originalFrame.call(this)
    } finally {
      if (query && timing) {
        timing.gl.endQuery(timing.extension.TIME_ELAPSED_EXT)
        timing.pending.push(query)
      }
    }
    if (timing) {
      const disjoint = !!timing.gl.getParameter(timing.extension.GPU_DISJOINT_EXT)
      timing.disjoint ||= disjoint
      for (const pending of [...timing.pending]) {
        if (!disjoint && !timing.gl.getQueryParameter(pending, timing.gl.QUERY_RESULT_AVAILABLE)) continue
        if (!disjoint) timing.durationsMs.push(timing.gl.getQueryParameter(pending, timing.gl.QUERY_RESULT) / 1e6)
        timing.gl.deleteQuery(pending)
        timing.pending.splice(timing.pending.indexOf(pending), 1)
      }
    }
    lastFrame = {
      ticks: simulationTicks - before,
      passes: runtime.diagnostics,
      render: { ...e.renderer.info.render },
      durationMs: performance.now() - started
    }
    if (stateBefore.state !== runtime.diagnostics.state || (!backendBefore && privateField(runtime, 'backend')))
      activationEvents.push({
        at: performance.now(),
        before: stateBefore,
        after: runtime.diagnostics,
        engineFrameMs: lastFrame.durationMs,
        firstBackendActivation: !backendBefore && !!privateField(runtime, 'backend')
      })
    functionalCapture?.()
  }
  const getBody = (id: number) => {
    const b = registry.entries().find((body) => body.actorId === id)
    if (!b) throw new Error(`Body ${id} not registered`)
    return b
  }
  const geometry = (body: CloudBodyEntry) => {
    const materials: Record<string, number> = {}
    body.object.traverse((object) => {
      if (!(object instanceof Mesh)) return
      for (const m of Array.isArray(object.material) ? object.material : [object.material])
        materials[m.constructor.name] = (materials[m.constructor.name] ?? 0) + 1
    })
    return materials
  }
  const visibleGeometry = (body: CloudBodyEntry) => {
    const materials: Record<string, number> = {}
    const owners: unknown[] = []
    body.object.traverseVisible((object) => {
      if (!(object instanceof Mesh)) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material.visible) continue
        materials[material.constructor.name] = (materials[material.constructor.name] ?? 0) + 1
        owners.push({
          name: object.name,
          owner: object.constructor.name,
          material: material.constructor.name,
          triangles: (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3
        })
      }
    })
    return { materials, owners }
  }
  const sources = (body: CloudBodyEntry) =>
    [...body.resourcePaths].map(([id, path]) => {
      const snapshot = resourceStorage.getTextureSnapshot(path),
        image = snapshot?.texture.image as { width?: number; height?: number } | undefined
      return {
        id,
        path,
        width: image?.width,
        height: image?.height,
        image: image?.constructor?.name,
        revision: snapshot?.revision,
        textureVersion: snapshot?.textureVersion,
        sourceVersion: snapshot?.sourceVersion
      }
    })
  const stopSourceObservation = resourceStorage.subscribeTextureChanges((path) => {
    for (const body of registry.entries()) {
      const ids = [...body.resourcePaths].filter(([, candidate]) => candidate === path).map(([id]) => id)
      if (ids.length)
        sourceNotifications.push({
          at: performance.now(),
          actorId: body.actorId,
          ids,
          path,
          sourceGeneration: privateField(runtime, 'generation'),
          diagnostics: runtime.diagnostics
        })
    }
  })
  const snapshot = (body?: CloudBodyEntry) => ({
    diagnostics: runtime.diagnostics,
    error: String(runtime.error ?? ''),
    simulationTicks,
    lastTickDelta,
    frame: lastFrame,
    camera: e.renderCamera.position.toArray(),
    quaternion: e.renderCamera.quaternion.toArray(),
    fov: e.renderCamera.fov,
    epoch: e.clock.epoch,
    viewport: [e.renderer.domElement.width, e.renderer.domElement.height],
    dpr: devicePixelRatio,
    rendererPixelRatio: e.renderer.getPixelRatio(),
    quality: settingsStore.cloudQuality,
    sources: body ? sources(body) : [],
    geometry: body ? geometry(body) : {},
    visibleGeometry: body ? visibleGeometry(body) : null,
    sourceGeneration: privateField<number>(runtime, 'generation'),
    slot: lastPlan
      ? {
          actorId: lastPlan.atmosphere.actorId,
          bodyActorId: lastPlan.atmosphere.bodyActorId,
          generation: lastPlan.atmosphere.generation,
          ready: lastPlan.atmosphere.ready,
          serial: lastPlan.frame.serial,
          cameraMeters: lastPlan.frame.camera.position.toArray()
        }
      : null,
    inFlight: [...app.resourceObserver.inFlight],
    pendingUpgrades: app.resourceObserver.pendingUpgrades?.size,
    memory: { ...e.renderer.info.memory },
    programs: e.renderer.info.programs?.length,
    cloudOwner: !!privateField(runtime, 'backend'),
    preparedOwner: !!privateField(runtime, 'prepared'),
    renderBreakdown: structuredClone(renderBreakdown),
    depthOwner:
      !!privateField<object | null>(e.postprocessing, 'composition') &&
      !!privateField(privateField<object>(e.postprocessing, 'composition'), 'depth')
  })
  let checkpointSerial = 0
  const checkpoint = async (label: string, body?: CloudBodyEntry, detail?: unknown) => {
    const id = `${String(++checkpointSerial).padStart(3, '0')}-${label}`
    const data = { id, ...snapshot(body), detail }
    phases.push(data)
    // Node saves both screenshot and data before acknowledging; bounded if the controller disappears.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Artifact acknowledgement timeout: ${id}`)), 30000)
      host.__sceneCloudFlightCheckpoint = {
        id,
        data,
        acknowledge: () => {
          clearTimeout(timer)
          resolve()
        }
      }
    })
    delete host.__sceneCloudFlightCheckpoint
  }
  const wait = async (name: string, predicate: () => boolean, deadlineMs = 180000) => {
    phase(name)
    const start = performance.now()
    let progressAt = start
    const intervals: unknown[] = []
    let previous = await frame()
    while (!predicate()) {
      if (runtime.diagnostics.reason === 'error') throw new Error(`${name}: ${String(runtime.error)}`)
      if (performance.now() - start > deadlineMs) throw new Error(`${name} deadline: ${JSON.stringify(snapshot())}`)
      if (performance.now() - progressAt > 15000) {
        phase(`${name}: ${runtime.diagnostics.state}/${runtime.diagnostics.reason}`)
        evidence.currentReadiness = {
          name,
          elapsedMs: performance.now() - start,
          intervals,
          state: snapshot(registry.entries().find((b) => b.actorId === runtime.diagnostics.actorId))
        }
        progressAt = performance.now()
      }
      const now = await frame()
      const selected = registry.entries().find((b) => b.actorId === runtime.diagnostics.actorId)
      intervals.push({
        rafMs: now - previous,
        engineFrameMs: lastFrame.durationMs,
        state: runtime.diagnostics.state,
        reason: runtime.diagnostics.reason,
        sourceGeneration: privateField(runtime, 'generation'),
        sources: selected ? sources(selected).filter((s) => [26, 32].includes(s.id)) : []
      })
      previous = now
    }
    readiness.push({ name, waitMs: performance.now() - start, intervals })
    evidence.currentReadiness = null
    return performance.now() - start
  }
  const move = (body: CloudBodyEntry, altitudeKm: number, direction?: Vector3) => {
    e.camera.stopFollowing()
    e.scene.updateMatrixWorld(true)
    const center = body.object.getWorldPosition(new Vector3())
    const normal = direction?.clone() ?? center.clone().negate().normalize()
    e.renderCamera.position
      .copy(center)
      .addScaledVector(normal.normalize(), ((body.datumRadiusMeters + altitudeKm * 1000) * SpaceScale) / 1000)
    e.renderCamera.lookAt(center)
    e.renderCamera.updateMatrixWorld(true)
    e.cameraCollision.reset()
  }
  const settle = async (body: CloudBodyEntry, near: boolean) => {
    await wait(`${body.object.name}-${near ? 'volume' : 'far'}-ready`, () => {
      const d = runtime.diagnostics
      const source = sources(body).find((s) => s.id === (body.actorId === 7 ? 26 : 32))
      return (
        !!source &&
        source.width === 8192 &&
        (near ? d.actorId === body.actorId && d.effectiveWeight > 0 : d.effectiveWeight === 0)
      )
    })
    await frame()
    await frame()
  }
  const assertBudget = async () => {
    const before = runtime.diagnostics
    await frame()
    const after = runtime.diagnostics,
      delta = difference(after, before),
      weight = after.effectiveWeight
    assert(lastFrame.ticks === 1, 'exactly one simulation tick per Engine animation frame')
    assert(delta.finalRenders === 1, `one final render: ${JSON.stringify(delta)}`)
    assert(
      delta.cloudUpdates === (weight > 0 ? 1 : 0) &&
        delta.shadowUpdates === (weight > 0 ? 1 : 0) &&
        delta.depthPasses === (weight > 0 ? 1 : 0),
      `one-volume depth/cloud/shadow budget: ${JSON.stringify(delta)}`
    )
    assert(
      delta.farRenders === (weight < 1 ? 1 : 0) && delta.nearRenders === (weight > 0 ? 1 : 0),
      `endpoint budget at ${weight}: ${JSON.stringify(delta)}`
    )
    return delta
  }
  const sample = async (label: string, body: CloudBodyEntry) => {
    phase(`performance-${label}-warmup120-measure300`)
    for (let i = 0; i < 120; i++) await frame()
    const intervals: number[] = [],
      draws: unknown[] = []
    if (gpuTiming) {
      gpuTiming.durationsMs = []
      gpuTiming.disjoint = false
    }
    let previous = await frame()
    gpuMeasurementActive = true
    for (let i = 0; i < 300; i++) {
      const now = await frame()
      intervals.push(now - previous)
      previous = now
      draws.push({
        renderBreakdown: structuredClone(renderBreakdown),
        render: lastFrame.render,
        cpuSliceMs: lastFrame.durationMs,
        diagnostics: runtime.diagnostics,
        memory: { ...e.renderer.info.memory }
      })
    }
    gpuMeasurementActive = false
    for (let i = 0; i < 10 && gpuTiming?.pending.length; i++) await frame()
    const sorted = [...intervals].sort((a, b) => a - b)
    const gpu =
      gpuTiming && !gpuTiming.disjoint && gpuTiming.durationsMs.length
        ? {
            kind: 'EXT_disjoint_timer_query_webgl2 whole Engine frame',
            durationsMs: [...gpuTiming.durationsMs],
            count: gpuTiming.durationsMs.length,
            disjoint: false
          }
        : { kind: 'unavailable or disjoint; RAF intervals only', disjoint: gpuTiming?.disjoint ?? false }
    const result = {
      label,
      intervalKind: 'CPU/RAF frame intervals, not GPU milliseconds',
      warmup: 120,
      count: 300,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      intervals,
      draws,
      gpu,
      state: snapshot(body)
    }
    performanceStates.push(result)
    await checkpoint(label, body, { p50: result.p50, p95: result.p95 })
  }
  const verifyVisibleDepth = async (label: string, required?: 'peak' | 'Io') => {
    const composition = privateField<object>(e.postprocessing, 'composition')
    const depth = privateField<object>(composition, 'depth')
    const resolved = privateField<WebGLRenderTarget>(depth, 'resolved')
    assert(!!resolved, 'real main composition produced merged geometry/water depth')
    const material = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { map: { value: resolved.texture }, at: { value: new Vector2() } },
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: 'uniform sampler2D map;uniform vec2 at;void main(){gl_FragColor=vec4(texture2D(map,at).r);}'
    })
    const target = new WebGLRenderTarget(1, 1, { type: FloatType, depthBuffer: false })
    const scene = new Scene(),
      quad = new Mesh(new PlaneGeometry(2, 2), material)
    // Clip-space quad placement is independent of the distant production camera.
    quad.frustumCulled = false
    scene.add(quad)
    const meshes: Mesh[] = []
    e.scene.traverseVisible((o) => {
      if (
        o instanceof Mesh &&
        (Array.isArray(o.material) ? o.material : [o.material]).some((m) =>
          ['WaterMaterial', 'TerrainMaterial', 'SphereSurfaceMaterial'].includes(m.constructor.name)
        )
      )
        meshes.push(o)
    })
    const rays = new Raycaster(),
      points: unknown[] = [],
      categories = new Set<string>()
    let foundRequired = !required
    const saved = e.renderer.getRenderTarget()
    try {
      for (const y of [0.3, 0.5, 0.7])
        for (const x of [0.3, 0.5, 0.7]) {
          rays.setFromCamera(new Vector2(x * 2 - 1, y * 2 - 1), e.renderCamera)
          const hit = rays.intersectObjects(meshes, false)[0]
          if (!hit) continue
          const mesh = hit.object as Mesh,
            materialName = (Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material)
              .constructor.name
          const ancestors = [mesh.name]
          mesh.traverseAncestors((o) => ancestors.push(o.name))
          const earth = registry.entries().find((b) => b.actorId === 7)
          const surfaceAltitudeMeters = earth
            ? (hit.point.distanceTo(earth.object.getWorldPosition(new Vector3())) * 1000) / SpaceScale -
              earth.datumRadiusMeters
            : null
          const requiredHit =
            required === 'Io'
              ? ancestors.includes('Io')
              : required === 'peak'
                ? materialName === 'TerrainMaterial' &&
                  surfaceAltitudeMeters! > earth!.descriptor.volume!.layers[0].baseAltitudeMeters
                : false
          if (categories.has(materialName) && !requiredHit) continue
          material.uniforms.at.value.set(x, y)
          e.renderer.setRenderTarget(target)
          const beforeReadCalls = e.renderer.info.render.calls
          e.renderer.render(scene, e.renderCamera)
          assert(
            e.renderer.info.render.calls === beforeReadCalls + 1,
            'depth readback fullscreen quad actually draws once'
          )
          const pixel = new Float32Array(4)
          e.renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
          const cosine = rays.ray.direction.dot(e.renderCamera.getWorldDirection(new Vector3()))
          const actualMeters = decodeSceneCloudDepth(
            pixel[0],
            Math.log2(e.renderCamera.far + 1),
            1000 / SpaceScale,
            cosine
          )
          const expectedMeters = (hit.distance * 1000) / SpaceScale
          const error = Math.abs(actualMeters - expectedMeters) / Math.max(1, expectedMeters)
          maxError = Math.max(maxError, error)
          assert(
            Number.isFinite(actualMeters) && error < 0.03,
            `${label} actual ${materialName} merged depth agrees with visible geometry within3% (log-depth/raster/wave tolerance): ${actualMeters}/${expectedMeters}`
          )
          points.push({
            x,
            y,
            material: materialName,
            ancestors,
            surfaceAltitudeMeters,
            actualMeters,
            expectedMeters,
            relativeError: error
          })
          foundRequired ||= requiredHit
          categories.add(materialName)
        }
      assert(points.length > 0, `${label} has actual geometry depth samples`)
      assert(foundRequired, `${label} samples the required original ${required} geometry`)
    } finally {
      e.renderer.setRenderTarget(saved)
      target.dispose()
      material.dispose()
      quad.geometry.dispose()
    }
    await checkpoint(label, undefined, { depthSamples: points })
  }
  try {
    e.clock.setSpeedOfTime(0)
    e.clock.setEpoch(2451545)
    settingsStore.setCloudQuality('medium')
    e.renderCamera.fov = 50
    e.renderCamera.updateProjectionMatrix()
    const gl = e.renderer.getContext() as WebGL2RenderingContext
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    const timerExtension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
      TIME_ELAPSED_EXT: number
      GPU_DISJOINT_EXT: number
    } | null
    if (timerExtension) gpuTiming = { gl, extension: timerExtension, pending: [], durationsMs: [], disjoint: false }
    evidence.environment = {
      gpu,
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      rendererPixelRatio: e.renderer.getPixelRatio(),
      epoch: e.clock.epoch,
      quality: settingsStore.cloudQuality,
      timerQueryAvailable: !!timerExtension,
      gpuTiming: 'Optional asynchronous whole Engine frame queries; accept only nondisjoint samples',
      renderCounters:
        'info.autoReset=false; reset before each Engine.renderFrame; all renderer draws within that frame',
      baselineTerrain: baseline?.terrain.sample ?? null
    }
    if (baseline) {
      assert(gpu === baseline.terrain.sample.gpu, 'GPU matches the requested saved baseline')
      assert(
        innerWidth === baseline.terrain.sample.viewport[0] &&
          innerHeight === baseline.terrain.sample.viewport[1] &&
          devicePixelRatio === baseline.terrain.sample.dpr &&
          e.renderer.getPixelRatio() === baseline.terrain.sample.rendererPixelRatio,
        'viewport and DPR match the requested saved baseline'
      )
    }
    assert(
      innerWidth === 1280 && innerHeight === 800 && devicePixelRatio === 1 && e.renderer.getPixelRatio() === 1,
      'flight viewport and DPR'
    )
    cases.push('production-solar-boot')
    const earth = getBody(7)
    if (scope === 'full') {
      // About17 projected pixels: visible legacy sphere, below the production32px
      // height-load threshold. No forced visibility, geometry or residency changes.
      await frame()
      move(earth, (99 * earth.datumRadiusMeters) / 1000)
      await wait('earth-visible-far-sphere', () => {
        const visible = visibleGeometry(earth).materials
        return (
          (visible.SphereSurfaceMaterial ?? 0) > 0 && !(visible.TerrainMaterial ?? 0) && !(visible.WaterMaterial ?? 0)
        )
      })
      await checkpoint('earth-visible-far-sphere', earth)
    }
    // A deterministic real-app position makes functional coverage independent of
    // old-device files. An explicitly supplied baseline retains its original pose.
    if (baseline) {
      e.renderCamera.position.fromArray(baseline.terrain.pose.camera)
      e.renderCamera.quaternion.fromArray(baseline.terrain.pose.quaternion)
      e.cameraCollision.reset()
    } else {
      await frame()
      move(earth, 70)
    }
    const terrainReferencePose: Pose = {
      camera: e.renderCamera.position.toArray(),
      quaternion: e.renderCamera.quaternion.toArray()
    }
    await settle(earth, true)
    if (scope === 'full')
      await checkpoint('cold-first-volume-entry', earth, {
        resourcesPrewarmed: false,
        description:
          'Direct first approach while ordinary actor assets arrive; no resource-ready wait before volume preparation.'
      })
    await wait(
      'earth-terrain-water-and-streaming',
      () =>
        (geometry(earth).TerrainMaterial ?? 0) > 0 &&
        (geometry(earth).WaterMaterial ?? 0) > 0 &&
        app.resourceObserver.inFlight.size === 0
    )
    assert(
      (visibleGeometry(earth).materials.TerrainMaterial ?? 0) > 0 &&
        (visibleGeometry(earth).materials.WaterMaterial ?? 0) > 0,
      'production far sphere swaps to visible loaded terrain and water'
    )
    const originalCloud = resourceStorage.getTexture(earth.resourcePaths.get(26)!)!
    const originalImage = originalCloud.image
    if (!(originalImage instanceof ImageBitmap)) throw new Error('Expected the streamed Earth cloud bitmap')
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 256
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(originalImage, 0, 0, 512, 256)
    const pixels = context.getImageData(0, 0, 512, 256).data
    const sun = earth.object.getWorldPosition(new Vector3()).negate().normalize()
    const rotation = earth.getSurface()!.getWorldQuaternion(new Quaternion())
    let cloudy: { mean: number; normal: Vector3; uv: number[] } | null = null
    for (let y = 8; y < 248; y += 2)
      for (let x = 4; x < 508; x += 2) {
        const u = (x + 0.5) / 512,
          v = (y + 0.5) / 256,
          theta = Math.PI * (1 - v),
          phi = 2 * Math.PI * u
        const normal = new Vector3(
          -Math.sin(theta) * Math.cos(phi),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(phi)
        ).applyQuaternion(rotation)
        if (normal.dot(sun) < 0.6) continue
        let mean = 0
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const at = ((y + dy) * 512 + x + dx) * 4
            mean += (pixels[at] + pixels[at + 1] + pixels[at + 2]) / 3
          }
        mean /= 49
        if (!cloudy || mean > cloudy.mean) cloudy = { mean, normal, uv: [u, v] }
      }
    assert(cloudy && cloudy.mean > 150, 'original Earth map supplies a dense daylight white reference')
    const direction = cloudy!.normal
    await checkpoint('earth-authored-cloudy-region', earth, {
      sourceWidth: originalImage.width,
      sourceHeight: originalImage.height,
      meanEncodedRgb: cloudy!.mean,
      uv: cloudy!.uv,
      worldNormal: direction.toArray()
    })
    if (scope === 'full') {
      for (const altitude of [150, 130, 110, 90, 70, 12, 10, 8, 6, 4, 2]) {
        move(earth, altitude, direction)
        await settle(earth, altitude < 150)
        const budget = await assertBudget()
        await checkpoint(`earth-${altitude}km`, earth, { altitudeKm: altitude, budget })
        if ([150, 110, 70].includes(altitude)) await sample(`earth-${altitude}km-performance`, earth)
      }
      // Same ready resource intent, exact reference camera; no outside-cutoff detour is
      // needed between the altitude path and the matched shoreline measurement.
      e.renderCamera.position.fromArray(terrainReferencePose.camera)
      e.renderCamera.quaternion.fromArray(terrainReferencePose.quaternion)
      e.cameraCollision.reset()
      await settle(earth, true)
      await wait('terrain-reference-ready-resources', () => app.resourceObserver.inFlight.size === 0)
      await sample(baseline ? 'earth-saved-terrain-reference-near' : 'earth-current-terrain-reference-near', earth)
      await verifyVisibleDepth('earth-reference-visible-depth')
      cases.push('earth-altitude-path', 'frame-budget', 'sphere-terrain-water', 'isolated-main-performance')
      move(earth, 90, direction)
      await settle(earth, true)
      e.camera.setSpeed(1000)
      const beforeControl = e.renderCamera.position.clone()
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
      try {
        for (let i = 0; i < 12; i++) {
          await frame()
          await assertBudget()
        }
      } finally {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }))
      }
      assert(e.renderCamera.position.distanceTo(beforeControl) > 0, 'production KeyW control moves the camera')
      await checkpoint('control-driven-earth', earth)
      cases.push('control-flight')
      const ticks = simulationTicks
      const observedCaptureDeltas: number[] = []
      captureDeltas = observedCaptureDeltas
      const capture = e.postprocessing.captureScreenshot()
      captureDeltas = null
      assert(
        simulationTicks === ticks && observedCaptureDeltas.length === 1 && observedCaptureDeltas[0] === 0,
        'synchronous capture render uses delta0 and advances no simulation'
      )
      // PNG encoding is asynchronous; ordinary Engine RAF ticks may continue while it completes.
      const blob = await capture
      assert(blob !== null, 'capture encoding completes')
      await checkpoint('capture-restored', earth, { captureDeltas: observedCaptureDeltas })
      cases.push('capture-no-simulation')
      for (const lighting of ['day', 'terminator', 'night']) {
        const center = earth.object.getWorldPosition(new Vector3()),
          sun = center.clone().negate().normalize()
        const normal =
          lighting === 'day'
            ? sun
            : lighting === 'night'
              ? sun.negate()
              : new Vector3().crossVectors(sun, new Vector3(0, 1, 0)).normalize()
        move(earth, 12, normal)
        await settle(earth, true)
        await checkpoint(`earth-${lighting}`, earth)
      }
      cases.push('day-terminator-night')
      move(earth, 12, direction)
      await settle(earth, true)
      const rotationBefore = earth.getSurface()!.getWorldQuaternion(new Quaternion())
      e.camera.setFollowTarget(earth.object)
      e.clock.setSpeedOfTime(1000)
      for (let i = 0; i < 12; i++) await frame()
      e.clock.setSpeedOfTime(0)
      assert(
        rotationBefore.angleTo(earth.getSurface()!.getWorldQuaternion(new Quaternion())) > 0,
        'body rotates through Engine simulation'
      )
      assert(e.camera.followTarget === earth.object, 'production follow target retained')
      await checkpoint('earth-rotation-follow', earth)
      e.camera.stopFollowing()
      e.clock.setEpoch(2451545)
      await frame()
      move(earth, -1, direction)
      await frame()
      const altitudeAfterCollision =
        (e.renderCamera.position.distanceTo(earth.object.getWorldPosition(new Vector3())) * 1000) / SpaceScale -
        earth.datumRadiusMeters
      assert(altitudeAfterCollision >= 0, 'production collision resolves an inside-datum camera')
      const collisionPlan = privateField<CloudFramePlan | null>(runtime, 'plan')
      if (collisionPlan)
        assert(
          collisionPlan.frame.camera.position.distanceTo(
            e.renderCamera.position
              .clone()
              .sub(collisionPlan.frame.centerWorld)
              .multiplyScalar(1000 / SpaceScale)
          ) < 0.01,
          'cloud frame uses the post-collision camera'
        )
      await checkpoint('earth-collision', earth, { altitudeAfterCollision })
      cases.push('body-rotation-follow-collision')
    }
    const terrain =
      earth.object.getObjectByProperty('type', 'TerrainSphere') ??
      (() => {
        let found: object | undefined
        earth.object.traverse((o) => {
          if (o.constructor.name === 'TerrainSphere') found = o
        })
        return found
      })()
    assert(terrain, 'original loaded TerrainSphere supplies the peak height field')
    const field = privateField<TerrainHeightField>(terrain!, 'field'),
      map = field.heightMap
    let peak = 0
    for (let i = 1; i < map.data.length; i++) if (map.data[i] > map.data[peak]) peak = i
    const peakU = ((peak % map.width) + 0.5) / map.width,
      peakV = (Math.floor(peak / map.width) + 0.5) / map.height
    const peakHeight = field.sampleMeters(peakU, peakV)
    const cloudBase = earth.descriptor.volume!.layers[0].baseAltitudeMeters
    assert(peakHeight > cloudBase, 'original Earth RAW peak rises inside the configured cloud layer')
    await checkpoint('earth-original-peak-source', earth, {
      peakHeight,
      cloudBase,
      peakU,
      peakV,
      minMeters: map.minMeters,
      maxMeters: map.maxMeters
    })
    const theta = Math.PI * peakV,
      phi = 2 * Math.PI * peakU
    const peakNormal = new Vector3(
      -Math.sin(theta) * Math.cos(phi),
      Math.cos(theta),
      Math.sin(theta) * Math.sin(phi)
    ).applyQuaternion(earth.getSurface()!.getWorldQuaternion(new Quaternion()))
    move(earth, 14, peakNormal)
    await settle(earth, true)
    for (let i = 0; i < 90; i++) await frame()
    await verifyVisibleDepth('earth-original-peak-depth', 'peak')
    cases.push('original-peak-depth')
    // Functional comparison only: normal beginFrame still runs; one test-owned
    // return-null frame selects the original far endpoint at the exact near pose.
    move(earth, 70, direction)
    await settle(earth, true)
    const references = []
    for (const endpoint of ['near-before', 'forced-far', 'near-restored']) {
      forceFarReference = endpoint === 'forced-far'
      // A missing plan deliberately cancels GPU preparation. A restored endpoint
      // must retire its new fence before publication; capture one completed frame,
      // keeping the exact per-frame budget checks below.
      if (endpoint !== 'forced-far')
        await wait(`reference-${endpoint}-full-weight`, () => runtime.diagnostics.effectiveWeight === 1, 30000)
      const beforeReference = runtime.diagnostics
      const captured = await new Promise<
        ReturnType<typeof snapshot> & { screenshotDataUrl: string; endpoint: string; light: unknown }
      >((resolve, reject) => {
        const timer = setTimeout(() => {
          functionalCapture = null
          reject(new Error('Same-pose reference capture deadline'))
        }, 30000)
        functionalCapture = () => {
          try {
            const data = {
              ...snapshot(earth),
              endpoint,
              screenshotDataUrl: e.renderer.domElement.toDataURL('image/png'),
              budget: difference(runtime.diagnostics, beforeReference),
              requestedPlanWeight: lastPlan?.requestedWeight,
              light: lastPlan
                ? {
                    sunDirection: lastPlan.frame.sunDirection.toArray(),
                    color: lastPlan.frame.lightColor.toArray(),
                    lambert: lastPlan.frame.lambert,
                    exposure: e.renderer.toneMappingExposure,
                    toneMapping: e.renderer.toneMapping
                  }
                : null
            }
            functionalCapture = null
            evidence.endpointReferences.push(data)
            assert(
              !!lastPlan && lastPlan.requestedWeight > 1 - 1e-12,
              'reference retains a valid full-near requested plan'
            )
            assert(
              runtime.diagnostics.effectiveWeight === (endpoint === 'forced-far' ? 0 : 1),
              `reference ${endpoint} reports its actual endpoint weight: ${runtime.diagnostics.effectiveWeight}`
            )
            const expectedBudget =
              endpoint === 'forced-far'
                ? { depthPasses: 0, cloudUpdates: 0, shadowUpdates: 0, farRenders: 1, nearRenders: 0, finalRenders: 1 }
                : { depthPasses: 1, cloudUpdates: 1, shadowUpdates: 1, farRenders: 0, nearRenders: 1, finalRenders: 1 }
            assert(
              JSON.stringify(data.budget) === JSON.stringify(expectedBudget),
              `reference ${endpoint} has exact producer/endpoint budget: ${JSON.stringify(data.budget)}`
            )
            clearTimeout(timer)
            resolve(data)
          } catch (error) {
            functionalCapture = null
            clearTimeout(timer)
            reject(error)
          }
        }
      })
      references.push(captured)
    }
    forceFarReference = false
    for (const reference of references) {
      assert(
        JSON.stringify(reference.camera) === JSON.stringify(references[0].camera) &&
          JSON.stringify(reference.quaternion) === JSON.stringify(references[0].quaternion),
        'far/near reference holds camera fixed'
      )
      assert(
        JSON.stringify(reference.light) === JSON.stringify(references[0].light) &&
          reference.sourceGeneration === references[0].sourceGeneration &&
          JSON.stringify(reference.sources) === JSON.stringify(references[0].sources) &&
          reference.slot?.generation === references[0].slot?.generation,
        'far/near reference holds light, exposure and source generation fixed'
      )
      assert(reference.epoch === references[0].epoch, 'far/near reference holds epoch fixed')
    }
    assert(
      references[1].frame.passes.farRenders - references[0].frame.passes.farRenders === 1 &&
        references[1].frame.passes.nearRenders === references[0].frame.passes.nearRenders,
      'one forced-far reference frame renders far without near'
    )
    assert(
      references[2].frame.passes.nearRenders - references[1].frame.passes.nearRenders >= 1,
      'reference restores near after bounded GPU preparation'
    )
    await checkpoint('same-pose-far-near-reference', earth, {
      references,
      limitation:
        'Test-only composition bypass for one functional frame, followed by bounded GPU preparation; excludes performance sampling. No source/material/albedo/lighting/exposure mutation.'
    })
    cases.push('same-pose-far-near-reference')
    const jupiter = getBody(10)
    move(jupiter, 1100)
    await settle(jupiter, false)
    for (const altitude of [1100, 1030, 900, 500, 130, 100, 30, 20, 10]) {
      move(jupiter, altitude)
      await settle(jupiter, altitude < 1030)
      await checkpoint(`jupiter-${altitude}km`, jupiter, { budget: await assertBudget() })
      if ([1100, 500, 100].includes(altitude)) await sample(`jupiter-${altitude}km-performance`, jupiter)
    }
    const io = e.scene.getObjectByName('Io')
    assert(!!io, 'original foreground moon Io is present')
    const jupiterCenter = jupiter.object.getWorldPosition(new Vector3()),
      ioCenter = io!.getWorldPosition(new Vector3())
    const ioDirection = ioCenter.clone().sub(jupiterCenter).normalize()
    const ioDistanceKm = ioCenter.distanceTo(jupiterCenter) / SpaceScale
    move(jupiter, ioDistanceKm - jupiter.datumRadiusMeters / 1000 + 6000, ioDirection)
    await settle(jupiter, false)
    assert(
      runtime.diagnostics.reason === 'outside-lod' && runtime.diagnostics.effectiveWeight === 0,
      'authored Io foreground lies outside the fixed Jupiter volume activation region'
    )
    const foregroundMeshes = new Set<Mesh>()
    for (const root of [io!, jupiter.object])
      root.traverseVisible((object) => {
        if (
          object instanceof Mesh &&
          (Array.isArray(object.material) ? object.material : [object.material]).some((material) =>
            ['SphereSurfaceMaterial', 'TerrainMaterial'].includes(material.constructor.name)
          )
        )
          foregroundMeshes.add(object)
      })
    const foregroundRay = new Raycaster()
    foregroundRay.setFromCamera(new Vector2(), e.renderCamera)
    const foregroundHits = foregroundRay.intersectObjects([...foregroundMeshes], false)
    const firstAncestors: string[] = []
    foregroundHits[0]?.object.traverseAncestors((object) => firstAncestors.push(object.name))
    assert(firstAncestors.includes('Io'), 'original authored Io geometry is in front of the Jupiter far endpoint')
    await checkpoint('foreground-authored-io-far-only', jupiter, {
      budget: await assertBudget(),
      firstAncestors,
      rayDistanceSceneUnits: foregroundHits[0]?.distance,
      ioCenter: ioCenter.toArray(),
      jupiterCenter: jupiterCenter.toArray(),
      ioDistanceKm,
      limitation:
        'Actual Io cannot be foreground inside the fixed near activation region. This is far endpoint evidence; no stale near depth is sampled. Near foreground-volume numerical coverage belongs to the depth probe.'
    })
    cases.push('jupiter-altitude-path')
    const originalQuality = settingsStore.cloudQuality
    const verifyPlanetProfile = async (actorId: number) => {
      const body = getBody(actorId),
        config = body.descriptor.volume
      assert(config, `planet ${actorId} has a volume profile`)
      if (!config) throw new Error(`Missing cloud profile ${actorId}`)
      const layer = config.layers[0],
        top = layer.baseAltitudeMeters + layer.thicknessMeters
      for (const quality of ['high', 'medium', 'low'] as const) {
        settingsStore.setCloudQuality(quality)
        for (const altitudeMeters of [top + 8000, layer.baseAltitudeMeters + layer.thicknessMeters * 0.45]) {
          move(body, altitudeMeters / 1000)
          await wait(`planet-${actorId}-${quality}-${altitudeMeters}`, () => {
            const d = runtime.diagnostics
            return (
              d.actorId === actorId &&
              d.state === 'active' &&
              d.effectiveWeight === 1 &&
              app.resourceObserver.inFlight.size === 0
            )
          })
          for (let i = 0; i < 64; i++) await frame()
          const backend = privateField<{ effect: { cloudsPass: { historyRenderTarget: WebGLRenderTarget } } }>(
            runtime,
            'backend'
          )
          const target = backend.effect.cloudsPass.historyRenderTarget
          assert(target.texture.type === HalfFloatType, 'profile history uses native RGBA16F')
          const pixels = new Uint16Array(target.width * target.height * 4)
          e.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels)
          assert(
            pixels.every((value) => (value & 0x7c00) !== 0x7c00),
            `finite planet ${actorId} ${quality} volume`
          )
          await checkpoint(`planet-${actorId}-${quality}-${altitudeMeters}`, body, {
            budget: await assertBudget(),
            historySize: [target.width, target.height]
          })
        }
      }
      move(body, (top + config.lod.cutoffDistanceMeters + 100000) / 1000)
      await wait(
        `planet-${actorId}-outside-cutoff`,
        () => !privateField(runtime, 'backend') && runtime.diagnostics.effectiveWeight === 0
      )
      await checkpoint(`planet-${actorId}-far`, body, { budget: await assertBudget() })
      cases.push(`planet-profile-${actorId}`)
    }
    for (const actorId of [6, 11, 12, 13, 29]) await verifyPlanetProfile(actorId)
    settingsStore.setCloudQuality(originalQuality)
    for (const body of [earth, jupiter, earth]) {
      move(body, body === earth ? 100 : 500)
      await frame()
      await checkpoint(`quick-switch-${body.actorId}`, body)
    }
    await settle(earth, true)
    cases.push('quick-body-switch')
    settingsStore.toggle('showClouds')
    await frame()
    await frame()
    assert(
      runtime.diagnostics.reason === 'off' && runtime.diagnostics.effectiveWeight === 0,
      'settings off releases volume'
    )
    await checkpoint('settings-off', earth)
    settingsStore.toggle('showClouds')
    await settle(earth, true)
    await checkpoint('settings-on', earth)
    cases.push('settings-toggle')
    // Consecutive moving-limb frames remain separate artifacts for visual inspection.
    move(earth, 100, direction)
    await settle(earth, true)
    e.renderCamera.rotateY(Math.asin(earth.datumRadiusMeters / (earth.datumRadiusMeters + 100000)))
    const consecutiveFrames: unknown[] = []
    let previousSerial: number | null = null
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        functionalCapture = null
        reject(new Error('Consecutive limb capture deadline'))
      }, 30000)
      functionalCapture = () => {
        try {
          const serial = privateField<number>(e.postprocessing, 'serial')
          assert(
            previousSerial === null || serial === previousSerial + 1,
            'moving limb uses consecutive completed Engine frames'
          )
          assert(lastFrame.ticks === 1, 'moving limb advances simulation exactly once per frame')
          consecutiveFrames.push({
            ...snapshot(earth),
            serial,
            screenshotDataUrl: e.renderer.domElement.toDataURL('image/png')
          })
          previousSerial = serial
          e.renderCamera.rotateY(0.006)
          if (consecutiveFrames.length === 6) {
            functionalCapture = null
            clearTimeout(timer)
            resolve()
          }
        } catch (error) {
          functionalCapture = null
          clearTimeout(timer)
          reject(error)
        }
      }
    })
    await checkpoint('moving-limb-consecutive', earth, {
      consecutiveFrames,
      screenshots:
        'Exact completed main canvas frames, embedded PNG data URLs; functional capture only, excluded from warm timings.'
    })
    cases.push('moving-limb-consecutive')
    const neptune = getBody(13)
    move(neptune, 5000)
    await wait(
      'authored-neptune-source',
      () =>
        sources(neptune).some((s) => s.id === 37 && s.width! > 1) &&
        !runtime.diagnostics.farFallbacks.some((s) => s.actorId === 13)
    )
    assert(neptune.descriptor.volume, 'Neptune has a volume profile')
    assert(!privateField(runtime, 'backend'), 'distant Neptune allocates no volume owner')
    await checkpoint('authored-neptune', neptune, { encoding: neptune.descriptor.far?.pattern.encoding })
    cases.push('authored-neptune')
    await engineStore.setScenario(Scenarios.find((s) => s.rootId === 86)!)
    e.clock.setSpeedOfTime(0)
    e.clock.setEpoch(2451545)
    const korriban = getBody(88)
    move(korriban, 300)
    await wait(
      'authored-korriban-source',
      () =>
        sources(korriban).some((s) => s.id === 113 && s.width! > 1) &&
        !runtime.diagnostics.farFallbacks.some((s) => s.actorId === 88)
    )
    assert(
      korriban.descriptor.volume && !privateField(runtime, 'backend'),
      'Korriban retains its authored far map outside the volume cutoff'
    )
    await checkpoint('authored-korriban', korriban, { encoding: korriban.descriptor.far?.pattern.encoding })
    cases.push('authored-korriban')
    for (const actorId of [88, 90]) await verifyPlanetProfile(actorId)
    for (const [scenarioId, actorIds] of [
      [3, [57]],
      [4, [63, 64]],
      [5, [82]],
      [12, [120]],
      [13, [130]]
    ] as const) {
      await engineStore.setScenario(Scenarios.find((s) => s.id === scenarioId)!)
      e.clock.setSpeedOfTime(0)
      e.clock.setEpoch(2451545)
      for (const actorId of actorIds) await verifyPlanetProfile(actorId)
    }
    settingsStore.setCloudQuality(originalQuality)
    await engineStore.setScenario(Scenarios.find((s) => s.rootId === 42)!)
    e.clock.setSpeedOfTime(0)
    e.clock.setEpoch(2451545)
    const lensRegistry = privateField<{
      entries(): {
        object: { visible: boolean; getWorldPosition(v: Vector3): Vector3 }
        simulationRadiusUnits: number
      }[]
    }>(e.postprocessing, 'lensRegistry')
    const lens = lensRegistry.entries()[0]
    assert(!!lens, 'real Sagittarius black hole registers a lens')
    const sgrPlanet = getBody(44)
    assert(sgrPlanet.descriptor.volume, 'Sgr A* I has an explicit appearance profile')
    move(sgrPlanet, 40)
    await wait(
      'sgr-a-cloud-lens-fallback',
      () => runtime.diagnostics.actorId === 44 && runtime.diagnostics.reason === 'lens'
    )
    assert(
      !privateField(runtime, 'backend') && runtime.diagnostics.effectiveWeight === 0,
      'active gravitational lens preserves the existing far-only compatibility fallback'
    )
    await checkpoint('sgr-a-cloud-lens-fallback', sgrPlanet)
    cases.push('sgr-a-cloud-lens-fallback')
    e.renderCamera.position
      .copy(lens.object.getWorldPosition(new Vector3()))
      .add(new Vector3(0, 0, lens.simulationRadiusUnits * 2))
    e.renderCamera.lookAt(lens.object.getWorldPosition(new Vector3()))
    e.cameraCollision.reset()
    await wait('real-lens-visible', () => lens.object.visible)
    for (let i = 0; i < 4; i++) await frame()
    assert(
      runtime.diagnostics.effectiveWeight === 0 && !privateField(runtime, 'backend'),
      'real lens scenario has no volume owner or overlay'
    )
    await checkpoint('real-lens-scenario')
    cases.push('real-lens-scenario')
    await engineStore.setScenario(null)
    for (let i = 0; i < 3; i++) {
      await engineStore.setScenario(Scenarios[0])
      e.clock.setSpeedOfTime(0)
      e.clock.setEpoch(2451545)
      await wait(`solar-exit-${i}-resource-readiness`, () => app.resourceObserver.inFlight.size === 0)
      for (let n = 0; n < 120; n++) await frame()
      await wait(`solar-exit-${i}-settled`, () => app.resourceObserver.inFlight.size === 0)
      await engineStore.setScenario(null)
      const state = snapshot()
      exits.push(state)
      assert(!state.cloudOwner && !state.depthOwner, 'scenario exit releases all cloud targets')
      assert(
        !state.preparedOwner && e.postprocessing.composer === null,
        'scenario exit releases derivatives and both HDR endpoint owners'
      )
      await checkpoint(`scenario-exit-${i}`)
      const baselineMemory = (exits[0] as ReturnType<typeof snapshot>).memory
      assert(
        state.memory.geometries === baselineMemory.geometries && state.memory.textures === baselineMemory.textures,
        `ready matched Solar exits return to the same geometry/texture baseline: ${JSON.stringify(state.memory)}/${JSON.stringify(baselineMemory)}`
      )
    }
    cases.push('stable-scenario-exits')
    phase('complete')
    return { name: 'flight', scope, checks, maxError, resourcesReleased: true, cases }
  } finally {
    stopSourceObservation()
    functionalCapture = null
    forceFarReference = false
    gpuMeasurementActive = false
    if (gpuTiming) for (const query of gpuTiming.pending) gpuTiming.gl.deleteQuery(query)
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }))
    e.clock.advance = originalAdvance
    e.renderFrame = originalFrame
    runtime.beginFrame = originalBegin
    e.postprocessing.render = originalRender
    e.renderer.render = originalDraw
    e.renderer.info.autoReset = originalAutoReset
  }
}
