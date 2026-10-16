import {
  Camera,
  Color,
  DataTexture,
  FloatType,
  Mesh,
  NoBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer
} from 'three'
import { ShaderPass } from 'postprocessing'
import { createRenderer } from '@/core/graphic/renderingFactories'
import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import type { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { EMPTY_LAYER, expLayer, type AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { SceneCloudBackend } from '@/core/clouds/takram/SceneCloudBackend'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import type { CloudsEffect } from '@takram/three-clouds'
import { SpaceScale } from '@/core/constants'
import type { Actor } from '@/core/models/Actor'
import type { SceneCloudProbeReport } from './probe'

export async function run(): Promise<SceneCloudProbeReport> {
  const report: SceneCloudProbeReport = {
    name: 'readiness',
    checks: 0,
    maxError: 0,
    resourcesReleased: false,
    cases: []
  }
  const windows: Array<{ start: number; end: number }> = []
  const check = (condition: boolean, label: string): void => {
    if (!condition) throw Error(label)
    report.checks++
  }
  const renderer = createRenderer({ logarithmicDepthBuffer: true, antialias: false }, 1)
  renderer.setSize(8, 8)
  renderer.debug.onShaderError = null
  renderer.debug.checkShaderErrors = false
  const input = new WebGLRenderTarget(8, 8, { type: FloatType })
  const target = new WebGLRenderTarget(1, 1, { type: FloatType, depthBuffer: false })
  const warm = new ShaderPass(
    new ShaderMaterial({
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: 'void main(){gl_FragColor=vec4(0.);}'
    })
  )
  warm.initialize(renderer, false, FloatType)
  warm.render(renderer, null, input)
  warm.dispose()
  const sharedGeometryBaseline = renderer.info.memory.geometries
  const geometry = new PlaneGeometry(2, 2),
    scene = new Scene(),
    camera = new Camera()
  const material = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'void main(){gl_FragColor=vec4(.125,.25,.5,1.);}'
  })
  scene.add(new Mesh(geometry, material))
  const ordinaryRender = (): void => {
    renderer.setRenderTarget(target)
    renderer.setViewport(0, 0, 1, 1)
    renderer.setScissorTest(false)
    renderer.render(scene, camera)
    const result = new Float32Array(4)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, result)
    check(result[0] === 0.125 && result[1] === 0.25 && result[2] === 0.5, 'same renderer ordinary material recovered')
    check(renderer.getContext().getError() === 0, 'ordinary recovered rendering has no GL error')
  }
  ordinaryRender()
  const baseline = { ...renderer.info.memory }
  const config: AtmosphereConfig = {
    solarIrradiance: [1.474, 1.8504, 1.91198],
    sunAngularRadius: 0.004,
    bottomRadius: 6371,
    topRadius: 6431,
    rayleighDensity: [EMPTY_LAYER, expLayer(8)],
    rayleighScattering: [0.005802, 0.013558, 0.0331],
    mieDensity: [EMPTY_LAYER, expLayer(1.2)],
    mieScattering: [0.003996, 0.003996, 0.003996],
    mieExtinction: [0.00444, 0.00444, 0.00444],
    miePhaseFunctionG: 0.8,
    absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
    absorptionExtinction: [0, 0, 0],
    groundAlbedo: [0.1, 0.1, 0.1],
    muSMin: -0.2
  }
  const model = {
    getAttribute: (name: string, fallback: unknown) => (name === 'id' ? 2 : fallback),
    renderingObject: { getAttribute: () => config }
  } as unknown as Actor
  const registry = new AtmosphereRegistry()
  const render = renderer.render
  let injectNext = false,
    escapedRenderErrors = 0,
    returnedFailedDraws = 0
  renderer.render = function (activeScene: Scene, activeCamera: Camera): void {
    const mesh = activeScene.children[0] as Mesh,
      candidate = mesh?.material
    let injected = false
    if (injectNext && candidate && !Array.isArray(candidate) && 'fragmentShader' in candidate) {
      candidate.fragmentShader = '#error scene_cloud_readiness_fixture\n' + candidate.fragmentShader
      candidate.needsUpdate = true
      injectNext = false
      injected = true
    }
    try {
      render.call(this, activeScene, activeCamera)
      if (injected) returnedFailedDraws++
    } catch (error) {
      escapedRenderErrors++
      throw error
    }
  }
  const expectedFailure = (work: () => unknown): Error => {
    const start = Date.now()
    let failure: Error | undefined
    try {
      work()
    } catch (error) {
      failure = error instanceof Error ? error : Error(String(error))
    } finally {
      windows.push({ start, end: Date.now() + 1 })
    }
    check(
      !!failure && /shader compilation failed/i.test(failure.message),
      'descriptive shader error outside actual render'
    )
    const gl = renderer.getContext()
    for (let i = 0; i < 16; i++) {
      const code = gl.getError()
      if (code === 0) break
      check(code === gl.INVALID_OPERATION, 'only intentional invalid-program GL operations are drained')
    }
    check(escapedRenderErrors === 0, 'shader and previous-handler errors never escape inside renderer.render')
    return failure!
  }
  const setState = () => {
    renderer.setRenderTarget(input)
    renderer.setViewport(1, 2, 3, 4)
    renderer.setScissor(2, 1, 4, 3)
    renderer.setScissorTest(true)
    renderer.setClearColor(0x123456, 0.3)
    renderer.autoClear = false
    return {
      viewport: renderer.getViewport(new Vector4()),
      scissor: renderer.getScissor(new Vector4()),
      color: renderer.getClearColor(new Color()),
      alpha: renderer.getClearAlpha(),
      target: renderer.getRenderTarget()
    }
  }
  const stateRestored = (
    saved: ReturnType<typeof setState>,
    previous: WebGLRenderer['debug']['onShaderError']
  ): void => {
    check(renderer.getRenderTarget() === saved.target, 'target restored')
    check(renderer.getViewport(new Vector4()).equals(saved.viewport), 'viewport restored')
    check(renderer.getScissor(new Vector4()).equals(saved.scissor) && renderer.getScissorTest(), 'scissor restored')
    check(
      renderer.getClearColor(new Color()).equals(saved.color) &&
        renderer.getClearAlpha() === saved.alpha &&
        !renderer.autoClear,
      'clear state restored'
    )
    check(
      renderer.debug.onShaderError === previous && !renderer.debug.checkShaderErrors,
      'previous debug handler/check restored'
    )
  }
  let owner: BrunetonAtmosphere | undefined
  let backend: SceneCloudBackend | undefined
  let prepared: ReturnType<typeof prepareCloudSource> | undefined
  const white = new DataTexture(new Uint8Array(32).fill(255), 4, 2)
  white.needsUpdate = true
  const depth = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  depth.needsUpdate = true
  try {
    // Null is the production default handler. The checker must force diagnostics even with checks initially false.
    injectNext = true
    const initialState = setState()
    expectedFailure(() => {
      owner = new BrunetonAtmosphere(model, renderer, registry)
    })
    check(!registry.get(2), 'failed initial LUT never registered ready')
    stateRestored(initialState, null)
    check(
      renderer.info.memory.textures === baseline.textures && renderer.info.memory.geometries === baseline.geometries,
      'failed initial generator releases all allocated resources'
    )
    ordinaryRender()
    report.cases.push('initial-default-shader-failure')

    owner = new BrunetonAtmosphere(model, renderer, registry)
    const entry = registry.get(2)!
    check(entry.ready, 'fresh initial retry became ready')
    const originalLut = entry.lut
    const oldGenerator = (owner as unknown as { lutGenerator: AtmosphereLUTGenerator }).lutGenerator
    const oldLutKey = (
      oldGenerator as unknown as { transmittanceMat: ShaderMaterial }
    ).transmittanceMat.customProgramCacheKey()
    const events = owner as unknown as { onContextLost(): void; onContextRestored(): void }
    events.onContextLost()
    check(!entry.ready, 'context loss pending before restore')
    let priorCalls = 0
    const previous = (): void => {
      priorCalls++
      check(!entry.ready, 'entry remains pending inside shader callback')
      throw Error('prior handler sentinel')
    }
    renderer.debug.onShaderError = previous
    injectNext = true
    const restoreState = setState()
    const error = expectedFailure(() => events.onContextRestored())
    check(
      error.message.includes('prior handler sentinel') && priorCalls === 1,
      'previous throwing callback chained and deferred'
    )
    check(!entry.ready, 'failed restored LUT remains pending')
    stateRestored(restoreState, previous)
    check(
      (owner as unknown as { lutGenerator: unknown }).lutGenerator === null,
      'failed generator retired before retry'
    )
    let staleRejected = false
    try {
      oldGenerator.generate(config)
    } catch (failure) {
      staleRejected = /failed|disposed/.test(String(failure))
    }
    check(staleRejected, 'cached failed generator cannot be republished')
    ordinaryRender()
    renderer.debug.onShaderError = null
    events.onContextRestored()
    check(
      entry.ready && entry.lut !== originalLut && entry.lut.transmittance !== originalLut.transmittance,
      'successful retry rebinds new LUT identities before ready'
    )
    const nextGenerator = (owner as unknown as { lutGenerator: AtmosphereLUTGenerator }).lutGenerator
    check(nextGenerator !== oldGenerator, 'retry constructs a new public generator')
    check(
      (nextGenerator as unknown as { transmittanceMat: ShaderMaterial }).transmittanceMat.customProgramCacheKey() !==
        oldLutKey,
      'LUT retry cache epoch cannot select a retained shared failed program'
    )
    ordinaryRender()
    report.cases.push('restore-retry', 'deferred-previous-handler', 'failed-program-retirement')

    const unit = SpaceScale / 1000
    const sceneCamera = new PerspectiveCamera(45, 1, 1e-6, 1.5e8)
    sceneCamera.position.set(0, 0, 6421000 * unit)
    sceneCamera.lookAt(0, 0, 0)
    sceneCamera.updateMatrixWorld()
    const local = sceneCamera.clone(false)
    local.position.set(0, 0, 6421000)
    local.near /= unit
    local.far /= unit
    local.updateProjectionMatrix()
    local.updateMatrixWorld()
    const frame: CloudFrame = {
      serial: 1,
      deltaSeconds: 0,
      actorId: 1,
      camera: local,
      sceneCamera,
      centerWorld: new Vector3(),
      planetRotation: new Quaternion(),
      datumRadiusMeters: 6371000,
      viewport: new Vector2(8, 8),
      sunDirection: new Vector3(0, 0, 1),
      lightColor: new Color(1, 1, 1),
      lambert: 1
    }
    prepared = prepareCloudSource(createEarthCloudProfile(), () => white)
    backend = new SceneCloudBackend(frame, entry, prepared, 'terrestrial', 'low')
    const active = (): CloudsEffect => (backend as unknown as { effect: CloudsEffect }).effect
    const noise = (): unknown => (backend as unknown as { noise: unknown }).noise
    const cloudRender = () =>
      backend!.render(
        renderer,
        input,
        frame,
        {
          texture: depth,
          sceneLogFarFactor: Math.log2(sceneCamera.far + 1),
          sceneUnitsToMeters: 1 / unit,
          viewport: frame.viewport,
          serial: frame.serial
        },
        entry
      )
    const failedEffect = active(),
      failedNoise = noise()
    const failedCloudKey = failedEffect.cloudsPass.currentMaterial.customProgramCacheKey()
    injectNext = true // First actual draw belongs to owned procedural noise.
    const backendState = setState()
    expectedFailure(cloudRender)
    stateRestored(backendState, null)
    check(
      active() !== failedEffect && noise() !== failedNoise,
      'failed noise initialization retires effect and noise together'
    )
    check(
      active().cloudsPass.currentMaterial.customProgramCacheKey() !== failedCloudKey,
      'cloud retry cache epoch isolates retained failed programs'
    )
    ordinaryRender()
    active().shadowMaps.mapSize.set(32, 32)
    const recovered = cloudRender()
    check(
      recovered.historyGeneration === 1 && recovered.atmosphereGeneration === entry.generation,
      'same backend publishes only new valid retry generation'
    )
    const previousEffect = active()
    previousEffect.cloudsPass.currentMaterial.fragmentShader =
      '#error scene_cloud_readiness_fixture\n' + previousEffect.cloudsPass.currentMaterial.fragmentShader
    previousEffect.cloudsPass.currentMaterial.needsUpdate = true
    renderer.debug.onShaderError = previous
    const secondState = setState()
    // Backend compilation does not invalidate already-good scene LUTs.
    renderer.debug.onShaderError = () => {
      throw Error('backend prior handler sentinel')
    }
    const cloudPrevious = renderer.debug.onShaderError
    const backendFailure = expectedFailure(cloudRender)
    check(backendFailure.message.includes('backend prior handler sentinel'), 'backend defers previous throwing handler')
    stateRestored(secondState, cloudPrevious)
    check(
      entry.ready && active() !== previousEffect,
      'cloud failure retires only owned effect and preserves ready scene LUTs'
    )
    renderer.debug.onShaderError = null
    active().shadowMaps.mapSize.set(32, 32)
    const secondRecovery = cloudRender()
    check(secondRecovery.historyGeneration === 2, 'second cloud retry cannot reuse poisoned cached program')
    check(renderer.getContext().getError() === 0, 'successful cloud retry has no GL errors')
    ordinaryRender()
    report.cases.push('backend-retry', 'noise-retry', 'same-renderer-recovery', 'state-restoration')
    check(returnedFailedDraws >= 3, 'actual failed draws returned normally before errors were propagated')
  } finally {
    backend?.dispose()
    owner?.dispose()
    prepared?.dispose()
    white.dispose()
    depth.dispose()
    renderer.render = render
    material.dispose()
    geometry.dispose()
    input.dispose()
    target.dispose()
    renderer.setRenderTarget(null)
    report.resourcesReleased =
      renderer.info.memory.textures === 0 && renderer.info.memory.geometries === sharedGeometryBaseline
    Object.assign(report, {
      expectedShaderFailureWindows: windows,
      escapedRenderErrors,
      returnedFailedDraws,
      sharedGeometryBaseline,
      memoryAfter: { ...renderer.info.memory }
    })
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return report
}
