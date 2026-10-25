/** Real Solar scene benchmark. Private access stays in test code, as in flight.gpu.ts. */
import {
  Mesh,
  Quaternion,
  Vector2,
  Vector3,
  type Clock,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
  type WebGLRenderTarget
} from 'three'
import { engineStore } from '@/ui/mobx/EngineStore'
import { settingsStore } from '@/ui/mobx/SettingsStore'
import { SpaceScale } from '@/core/constants'
import type { CameraController } from '@/core/camera/CameraController'
import type { CameraCollision } from '@/core/services/CameraCollision'
import type { SimulationClock } from '@/core/time/SimulationClock'
import type { Postprocessing } from '@/core/graphic/Postprocessing'
import type { CloudBodyEntry, CloudRegistry } from '@/core/services/CloudRegistry'
import type { CloudQuality } from '@/core/clouds/SceneCloudConfig'
import type { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { assertHardwareRenderer, collectGpuSamples } from './benchmarkTiming'

type View = 'above' | 'inside'
type Stage = 'cloud-current' | 'cloud-resolve' | 'shadows' | 'depth' | 'frame'
type EngineAccess = {
  scene: Scene
  renderCamera: PerspectiveCamera
  renderer: WebGLRenderer
  camera: CameraController
  cameraCollision: CameraCollision
  clock: SimulationClock
  renderClock: Clock
  postprocessing: Postprocessing
  renderFrame(): void
  sceneManager: { factory: { cloudRegistry: CloudRegistry } }
}
type EffectAccess = {
  frame: number
  cloudsPass: {
    currentPass: object
    resolvePass: object
    currentRenderTarget: WebGLRenderTarget
    historyRenderTarget: WebGLRenderTarget
  }
  shadowPass: object
}
type AppAccess = { engine: EngineAccess; resourceObserver: { inFlight: Set<string> } }
const field = <T>(owner: object, key: string): T => Reflect.get(owner, key) as T
const raf = () => new Promise(requestAnimationFrame)
const views = { above: { altitudeKm: 12, pitchDegrees: 8 }, inside: { altitudeKm: 6, pitchDegrees: 0 } } as const
// Fixed weather UV chosen by the earlier cloud-edge research. Never reselect a
// cheaper region dynamically when assets change: record the source hash instead.
const edge = { u: 0.488525390625, v: 0.68408203125 }
let session: { app: AppAccess; e: EngineAccess; body: CloudBodyEntry; restore(): void } | undefined

function access() {
  if (!session) throw new Error('Cloud benchmark has not been prepared')
  const { e } = session
  const runtime = e.postprocessing.cloudRuntime
  if (!runtime) throw new Error('Production cloud runtime absent')
  return { ...session, runtime }
}

function effect() {
  const { runtime } = access()
  const backend = field<object | null>(runtime, 'backend')
  if (!backend) throw new Error('Cloud backend absent')
  return field<EffectAccess>(backend, 'effect')
}

function surfaceNormal(body: CloudBodyEntry) {
  const surface = body.getSurface()
  if (!surface) throw new Error('Earth surface absent')
  const theta = (1 - edge.v) * Math.PI,
    phi = edge.u * Math.PI * 2
  return new Vector3(
    -Math.sin(theta) * Math.cos(phi),
    Math.cos(theta),
    Math.sin(theta) * Math.sin(phi)
  ).applyQuaternion(surface.getWorldQuaternion(new Quaternion()))
}

export function snapshot() {
  const { e, app, runtime, body } = access()
  let terrain = 0,
    water = 0,
    triangles = 0
  body.object.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material.visible) continue
      if (material.constructor.name === 'TerrainMaterial') terrain++
      if (material.constructor.name === 'WaterMaterial') water++
    }
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0) / 3
  })
  return {
    camera: e.renderCamera.position.toArray(),
    quaternion: e.renderCamera.quaternion.toArray(),
    projection: e.renderCamera.projectionMatrix.toArray(),
    fov: e.renderCamera.fov,
    drawingBuffer: e.renderer.getDrawingBufferSize(new Vector2()).toArray(),
    rendererPixelRatio: e.renderer.getPixelRatio(),
    quality: settingsStore.cloudQuality,
    epoch: e.clock.epoch,
    sourceGeneration: field<number>(runtime, 'generation'),
    diagnostics: runtime.diagnostics,
    inFlight: app.resourceObserver.inFlight.size,
    terrain,
    water,
    triangles,
    memory: { ...e.renderer.info.memory },
    programs: e.renderer.info.programs?.length
  }
}

function signature(state: ReturnType<typeof snapshot>) {
  // Pass counters advance normally; the scene, source and resident geometry must not.
  const { diagnostics, ...rest } = state
  return JSON.stringify({
    ...rest,
    actorId: diagnostics.actorId,
    weight: diagnostics.effectiveWeight,
    state: diagnostics.state
  })
}

async function settle() {
  const { runtime } = access()
  const deadline = performance.now() + 180000
  let previous = '',
    consecutive = 0
  while (consecutive < 120) {
    await raf()
    const state = snapshot()
    if (runtime.error || ['error', 'context-lost'].includes(state.diagnostics.state))
      throw new Error(`Cloud readiness failed: ${String(runtime.error)} ${JSON.stringify(state)}`)
    if (performance.now() > deadline) throw new Error(`Cloud readiness deadline: ${JSON.stringify(state)}`)
    const key = signature(state)
    const ready =
      state.diagnostics.actorId === 7 &&
      state.diagnostics.state === 'active' &&
      state.diagnostics.effectiveWeight === 1 &&
      state.inFlight === 0 &&
      state.terrain > 0 &&
      state.water > 0
    consecutive = ready && key === previous ? consecutive + 1 : 0
    previous = key
  }
}

export async function prepare(quality: CloudQuality) {
  if (!import.meta.env.DEV) throw new Error('Cloud benchmark requires the development server')
  if (session) throw new Error('Cloud benchmark already prepared')
  const app = field<AppAccess | null>(engineStore, 'app'),
    e = app?.engine
  if (
    !e ||
    !app ||
    engineStore.scenario?.id !== 1 ||
    engineStore.appLoadingStatus ||
    !document.querySelector('#canvas')
  )
    throw new Error('Cloud benchmark requires the normal Solar UI boot')
  const body = e.sceneManager.factory.cloudRegistry.entries().find((body) => body.actorId === 7)
  if (!body) throw new Error('Earth is not registered')
  const gl = e.renderer.getContext() as WebGL2RenderingContext
  if (!gl.getExtension('EXT_disjoint_timer_query_webgl2')) throw new Error('GPU timers unavailable')
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null
  assertHardwareRenderer(gpu)
  const oldDelta = e.renderClock.getDelta,
    oldElapsed = e.renderClock.elapsedTime
  const oldSettings = {
    showClouds: settingsStore.showClouds,
    cloudQuality: settingsStore.cloudQuality,
    showMarkers: settingsStore.showMarkers,
    showOrbitLines: settingsStore.showOrbitLines
  }
  session = {
    app,
    e,
    body,
    restore() {
      e.renderClock.getDelta = oldDelta
      e.renderClock.elapsedTime = oldElapsed
      Object.assign(settingsStore, oldSettings)
    }
  }
  e.clock.setSpeedOfTime(0)
  e.clock.setEpoch(2451545)
  e.renderClock.getDelta = () => 1 / 60
  e.renderClock.elapsedTime = 64
  settingsStore.showClouds = true
  settingsStore.showMarkers = false
  settingsStore.showOrbitLines = false
  settingsStore.setCloudQuality(quality)
  // Let the normal engine update Earth's transform at the pinned epoch.
  await raf()
  await raf()
  return {
    gpu,
    vendor: gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
    userAgent: navigator.userAgent,
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    webglVersion: gl.getParameter(gl.VERSION),
    epoch: 2451545,
    renderDelta: 1 / 60,
    renderElapsed: 64,
    edge,
    radiusMeters: body.datumRadiusMeters
  }
}

export async function setCase(quality: CloudQuality, view: View) {
  if (!Object.hasOwn(views, view)) throw new Error(`Unknown benchmark view: ${view}`)
  const { e, body, runtime } = access()
  settingsStore.setCloudQuality(quality)
  const { altitudeKm, pitchDegrees } = views[view]
  e.scene.updateMatrixWorld(true)
  const center = body.object.getWorldPosition(new Vector3()),
    normal = surfaceNormal(body)
  const north = new Vector3(0, 1, 0).applyQuaternion(body.getSurface()!.getWorldQuaternion(new Quaternion()))
  const tangent = north.addScaledVector(normal, -north.dot(normal)).normalize()
  const pitch = (pitchDegrees * Math.PI) / 180
  const direction = tangent.multiplyScalar(Math.cos(pitch)).addScaledVector(normal, -Math.sin(pitch))
  e.camera.stopFollowing()
  e.renderCamera.position
    .copy(center)
    .addScaledVector(normal, ((body.datumRadiusMeters + altitudeKm * 1000) * SpaceScale) / 1000)
  e.renderCamera.up.copy(normal)
  e.renderCamera.lookAt(e.renderCamera.position.clone().add(direction))
  e.renderCamera.updateMatrixWorld(true)
  e.cameraCollision.reset()
  e.postprocessing.invalidateCloudHistory()
  await settle()
  const prepared = field<ReturnType<typeof prepareCloudSource>>(runtime, 'prepared')
  const { width, height, data } = prepared.textures.weather.image
  if (!data) throw new Error('Prepared weather pixels absent')
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  const sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const pass = effect().cloudsPass
  return {
    quality,
    view,
    ...views[view],
    normal: normal.toArray(),
    sunCosine: normal.dot(center.clone().negate().normalize()),
    weather: { width, height, sha256 },
    cloudConfig: prepared.config,
    currentSize: [pass.currentRenderTarget.width, pass.currentRenderTarget.height],
    historySize: [pass.historyRenderTarget.width, pass.historyRenderTarget.height],
    state: snapshot()
  }
}

export async function measure(stage: Stage, count: number) {
  const { e, runtime } = access(),
    fx = effect()
  const depth = field<{ depth: object }>(e.postprocessing, 'composition').depth
  const targets: Record<Stage, [object, string]> = {
    'cloud-current': [fx.cloudsPass.currentPass, 'render'],
    'cloud-resolve': [fx.cloudsPass.resolvePass, 'render'],
    shadows: [fx.shadowPass, 'update'],
    depth: [depth, 'render'],
    frame: [e, 'renderFrame']
  }
  if (!Object.hasOwn(targets, stage)) throw new Error(`Unknown GPU stage: ${stage}`)
  const [owner, method] = targets[stage],
    before = snapshot()
  const generation = field<number>(runtime, 'generation')
  const result = await collectGpuSamples({
    gl: e.renderer.getContext() as WebGL2RenderingContext,
    owner,
    method,
    count,
    timeoutMs: 180000 + count * 100,
    readFrame() {
      if (effect() !== fx || field<number>(runtime, 'generation') !== generation)
        throw new Error('Cloud backend/source changed during GPU measurement')
      // effectiveWeight is reset during beginFrame and restored on completion;
      // it is validated by the before/after snapshots, not inside a draw.
      // Depth and Engine entry precede CloudsEffect's frame increment.
      return fx.frame + (stage === 'depth' || stage === 'frame' ? 1 : 0)
    }
  })
  const after = snapshot()
  if (signature(before) !== signature(after))
    throw new Error(`Scene changed during ${stage}: ${JSON.stringify({ before, after })}`)
  return { stage, ...result, disjoint: false, before, after }
}

export function dispose() {
  session?.restore()
  session = undefined
}
