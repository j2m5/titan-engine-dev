import {
  Camera,
  Color,
  DataTexture,
  FloatType,
  Material,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector2,
  WebGLRenderTarget
} from 'three'
import { createRenderer } from '@/core/graphic/renderingFactories'
import { Postprocessing } from '@/core/graphic/Postprocessing'
import { CloudRegistry, type CloudBodyEntry } from '@/core/services/CloudRegistry'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { LensRegistry } from '@/core/services/LensRegistry'
import { SceneCloudRuntime } from '@/core/clouds/SceneCloudRuntime'
import { SceneCloudBackend } from '@/core/clouds/takram/SceneCloudBackend'
import { SphereSurfaceMaterial } from '@/core/materials/SphereSurfaceMaterial'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import {
  bindResourceStorageContext,
  getRendererContextGeneration,
  resourceStorage
} from '@/core/services/ResourceStorage'
import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { EMPTY_LAYER, expLayer, type AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { SpaceScale } from '@/core/constants'
import type { Actor } from '@/core/models/Actor'
import type { CloudQuality } from '@/core/clouds/SceneCloudConfig'
import type { SceneCloudProbeReport } from './probe'

export async function run(): Promise<SceneCloudProbeReport> {
  const report: SceneCloudProbeReport = {
    name: 'lifecycle',
    checks: 0,
    maxError: 0,
    resourcesReleased: false,
    cases: []
  }
  const check = (ok: boolean, label: string) => {
    if (!ok) throw Error(label)
    report.checks++
  }
  const renderer = createRenderer({ logarithmicDepthBuffer: true, antialias: false }, 1)
  const releaseStorageContext = bindResourceStorageContext(renderer)
  renderer.setSize(16, 9)
  const observed = new Map<Texture, Set<string>>()
  const observe = (value: unknown, label: string) => {
    if (!(value instanceof Texture)) return
    let labels = observed.get(value)
    if (!labels) {
      labels = new Set()
      observed.set(value, labels)
    }
    labels.add(label)
  }
  const setTarget = renderer.setRenderTarget
  renderer.setRenderTarget = function (target, ...rest) {
    if (target) {
      observe(target.texture, 'target')
      observe(target.depthTexture, 'depth')
    }
    setTarget.call(this, target, ...rest)
  }
  const actualDraw = renderer.render
  renderer.render = function (drawScene, drawCamera) {
    drawScene.traverse((object) => {
      const owner = (object as Mesh).material
      for (const material of Array.isArray(owner) ? owner : owner ? [owner] : [])
        for (const [key, uniform] of Object.entries((material as ShaderMaterial).uniforms ?? {}))
          observe(uniform.value, key)
    })
    actualDraw.call(this, drawScene, drawCamera)
  }
  const allocated = () =>
    [...observed]
      .filter(([texture]) => (renderer.properties.get(texture) as { __webglTexture?: unknown }).__webglTexture)
      .map(([texture, labels]) => ({ uuid: texture.uuid, name: texture.name, labels: [...labels] }))
  const registry = new CloudRegistry(),
    atmospheres = new AtmosphereRegistry(),
    scene = new Scene()
  const camera = new PerspectiveCamera(45, 16 / 9, 1e-6, 1.5e8),
    unit = SpaceScale / 1000
  camera.position.set(0, 0, 6421000 * unit)
  camera.lookAt(0, 0, 0)
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
    getAttribute: (name: string, fallback: unknown) => (name === 'id' ? 8 : name === 'parentId' ? 7 : fallback),
    renderingObject: { getAttribute: () => config }
  } as unknown as Actor
  const profile = createEarthCloudProfile()
  const empty = { first: () => undefined, isNotEmpty: () => false }
  const surfaceModel = {
    getAttribute: (_name: string, fallback: unknown) => fallback,
    physicalObject: { getAttribute: () => 6371 },
    renderingObject: { getAttribute: () => ({ emission: 1, bumpScale: 0, terrainLambert: 1 }) },
    children: { where: () => empty },
    resources: { where: () => empty, first: () => undefined }
  } as unknown as Actor
  const material = new SphereSurfaceMaterial(surfaceModel)
  const receiver = material.sceneCloudReceiver
  const geometry = new SphereGeometry(6371000 * unit, 16, 8),
    mesh = new Mesh(geometry, material)
  scene.add(mesh)
  const body: CloudBodyEntry = {
    actorId: 7,
    object: mesh,
    getSurface: () => mesh,
    datumRadiusMeters: 6371000,
    descriptor: {
      state: 'configured',
      volume: profile,
      far: { pattern: profile.layers[0].pattern as never, color: profile.layers[0].color, mapping: profile.mapping },
      qualityProfile: 'terrestrial',
      issues: []
    },
    resourcePaths: new Map([
      [26, 'lifecycle-density'],
      [27, 'lifecycle-color']
    ]),
    lightColor: new Color(1, 1, 1),
    lambert: 1
  }
  let stopBody = registry.register(body),
    stopReceiver = registry.bindReceiver(7, receiver)
  const texture = (name: string, value = 255) => {
    const t = new DataTexture(new Uint8Array([value, value, value, 255]), 1, 1)
    t.name = name
    t.needsUpdate = true
    resourceStorage.addTexture(t)
    return t
  }
  let source = texture('lifecycle-density'),
    color = texture('lifecycle-color', 128)
  material.uniforms.diffuseMap.value = texture('lifecycle-base', 64)
  material.uniforms.lightPosition.value.set(0, 0, 1000)
  const ownedPrepared: Array<{ disposed: number }> = []
  const backendSizes: Array<readonly [number, number]> = []
  let deferred = false,
    finish: (() => void) | undefined
  const runtime = new SceneCloudRuntime(registry, {
    prepare: (authored, resolve) => {
      const prepared = prepareCloudSource(authored, resolve),
        disposal = { disposed: 0 },
        dispose = prepared.dispose.bind(prepared)
      ownedPrepared.push(disposal)
      prepared.dispose = () => {
        disposal.disposed++
        dispose()
      }
      if (!deferred) return prepared
      return new Promise((resolve) => {
        finish = () => resolve(prepared)
      })
    },
    createBackend: (...args) => {
      const backend = new SceneCloudBackend(...args),
        resize = backend.setSize
      backend.setSize = (width, height) => {
        backendSizes.push([width, height])
        resize.call(backend, width, height)
      }
      return backend
    }
  })
  const settings = { showClouds: true, cloudQuality: 'low' as CloudQuality }
  const post = new Postprocessing(
    renderer,
    scene,
    camera,
    atmospheres,
    new DepthVolumeRegistry(),
    new LensRegistry(),
    runtime,
    settings
  )
  // Production registers Postprocessing before scenario-owned atmosphere listeners.
  const atmosphere = new BrunetonAtmosphere(model, renderer, atmospheres)
  scene.add(atmosphere)
  const initialize = () => {
    post.initialize()
    post.composer!.autoRenderToScreen = false
    for (const pass of post.composer!.passes) pass.renderToScreen = false
  }
  initialize()
  const draw = () => {
    post.render(0)
    check(
      runtime.diagnostics.effectiveWeight > 0,
      `fresh volume: ${runtime.diagnostics.reason} ${String(runtime.error)}`
    )
  }
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const shared = new ShaderMaterial({
    uniforms: { map: { value: source } },
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'uniform sampler2D map;void main(){gl_FragColor=texture2D(map,vec2(.5));}'
  })
  const sharedQuad = new Mesh(new PlaneGeometry(2, 2), shared),
    sharedScene = new Scene(),
    readTarget = new WebGLRenderTarget(1, 1, { type: FloatType })
  sharedScene.add(sharedQuad)
  const borrowedReadable = (map: Texture) => {
    shared.uniforms.map.value = map
    renderer.setRenderTarget(readTarget)
    renderer.render(sharedScene, new Camera())
    const result = new Float32Array(4)
    renderer.readRenderTargetPixels(readTarget, 0, 0, 1, 1, result)
    renderer.setRenderTarget(null)
    check(result.every(Number.isFinite) && result[3] > 0, 'borrowed texture usable by another material')
  }
  const windows: Array<{ start: number; end: number }> = []
  const measurements: unknown[] = []
  const menuRecoveries: unknown[] = []
  const started = performance.now(),
    phases: unknown[] = []
  const phase = (name: string) => {
    const point = {
      name,
      elapsedMs: performance.now() - started,
      quality: settings.cloudQuality,
      viewport: renderer.getDrawingBufferSize(new Vector2()).toArray(),
      state: runtime.diagnostics.state
    }
    phases.push(point)
    console.info('SCENE_CLOUD_LIFECYCLE_PHASE', JSON.stringify(point))
  }
  const gl = renderer.getContext(),
    flags: Array<{ label: string; codes: number[]; start: number; end: number }> = []
  const checkGL = (label: string) => {
    const code = gl.getError()
    flags.push({ label, codes: [code], start: Date.now(), end: Date.now() })
    check(code === gl.NO_ERROR, `${label} GL error ${code}`)
  }
  const drainShaderFailure = (label: string, start: number) => {
    const codes: number[] = []
    for (let i = 0; i < 16; i++) {
      const code = gl.getError()
      if (code === gl.NO_ERROR) break
      codes.push(code)
      check(code === gl.INVALID_OPERATION, `${label} unexpected injected GL code ${code}`)
    }
    check(gl.getError() === gl.NO_ERROR, `${label} injection ended with a clear GL state`)
    const end = Date.now() + 1
    flags.push({ label, codes, start, end })
    windows.push({ start, end })
  }
  const restoreContext = async (label: string, retireFailedFixture?: () => void, duringMenu = false) => {
    phase(`${label}: loss begin`)
    const evictWithoutReupload = texture('lifecycle-loss-eviction')
    borrowedReadable(evictWithoutReupload)
    const sourceBeforeLoss = resourceStorage.getTextureSnapshot(evictWithoutReupload.name)!
    const contextGeneration = getRendererContextGeneration(renderer)
    if (duringMenu) {
      const cause = runtime.error
      check(cause !== null, 'menu exit starts with a latched compilation cause')
      post.dispose()
      stopReceiver()
      stopBody()
      check(
        post.composer === null && registry.entries().length === 0,
        'menu exit releases scene composition and registration'
      )
      runtime.setContextLost(false)
      check(runtime.error === cause, 'unpaired restore assertion cannot clear menu failure')
      phase(`${label}: scenario disposed before loss`)
    }
    checkGL(`${label} before loss`)
    const extension = gl.getExtension('WEBGL_lose_context')
    check(!!extension, 'context-loss extension available')
    const generation = atmospheres.get(8)!.generation,
      start = Date.now()
    const lost = new Promise<void>((resolve) =>
      renderer.domElement.addEventListener('webglcontextlost', () => resolve(), { once: true })
    )
    extension!.loseContext()
    await lost
    // These owners belong only to this fixture. Retain CPU/receiver/Uniform identities.
    Material.prototype.dispose.call(material)
    shared.dispose()
    geometry.dispose()
    sharedQuad.geometry.dispose()
    readTarget.dispose()
    retireFailedFixture?.()
    const sourceAfterLoss = resourceStorage.getTextureSnapshot(evictWithoutReupload.name)!
    check(
      sourceAfterLoss.texture === sourceBeforeLoss.texture &&
        sourceAfterLoss.image === sourceBeforeLoss.image &&
        sourceAfterLoss.revision === sourceBeforeLoss.revision &&
        sourceAfterLoss.textureVersion === sourceBeforeLoss.textureVersion &&
        sourceAfterLoss.sourceVersion === sourceBeforeLoss.sourceVersion,
      'production storage loss binding preserves borrowed source identity and content stamps'
    )
    check(
      runtime.diagnostics.state === (duringMenu ? 'unconfigured' : 'context-lost') &&
        runtime.diagnostics.effectiveWeight === 0 &&
        !atmospheres.get(8)!.ready,
      'actual loss clears output and LUT readiness'
    )
    const code = gl.getError()
    check(code === gl.CONTEXT_LOST_WEBGL || code === gl.NO_ERROR, `${label} only expected context-loss status ${code}`)
    flags.push({ label: `${label} deliberate context loss`, codes: [code], start, end: Date.now() })
    const updates = runtime.diagnostics.cloudUpdates
    post.render(0)
    check(runtime.diagnostics.cloudUpdates === updates, 'loss prevents GPU work')
    const restored = new Promise<void>((resolve) =>
      renderer.domElement.addEventListener('webglcontextrestored', () => resolve(), { once: true })
    )
    await frame()
    extension!.restoreContext()
    await restored
    check(
      getRendererContextGeneration(renderer) === contextGeneration + 1,
      'lifetime binding observes one genuine context generation'
    )
    resourceStorage.deleteTexture(evictWithoutReupload.name)
    checkGL(`${label} source eviction after restore without reupload`)
    check(
      atmospheres.get(8)!.ready &&
        atmospheres.get(8)!.generation > generation &&
        runtime.diagnostics.effectiveWeight === 0,
      'restore waits for current ready LUT and fresh output'
    )
    if (duringMenu) {
      check(
        post.composer === null && registry.entries().length === 0,
        'menu restore never resurrects disposed composition'
      )
      stopBody = registry.register(body)
      stopReceiver = registry.bindReceiver(7, receiver)
      initialize()
      check(runtime.diagnostics.effectiveWeight === 0, 'reentry requires first fresh cloud output')
      phase(`${label}: initialized after menu restore`)
    }
    post.composer!.autoRenderToScreen = false
    for (const pass of post.composer!.passes) pass.renderToScreen = false
    draw()
    if (duringMenu) {
      check(runtime.error === null, 'fresh context clears old menu compilation cause')
      menuRecoveries.push({
        label,
        contextGenerationBefore: contextGeneration,
        contextGenerationAfter: getRendererContextGeneration(renderer),
        readyLutGeneration: atmospheres.get(8)!.generation,
        effectiveWeight: runtime.diagnostics.effectiveWeight
      })
    }
    checkGL(`${label} restored fresh frame`)
    phase(`${label}: fresh restored output`)
  }
  try {
    settings.showClouds = false
    post.render(0)
    borrowedReadable(source)
    borrowedReadable(color)
    borrowedReadable(atmospheres.get(8)!.lut.transmittance)
    const baseline = { ...renderer.info.memory }
    const baselineTextures = allocated()
    phase('pre-cloud borrowed ownership baseline')
    settings.showClouds = true
    draw()
    settings.showClouds = false
    post.render(0)
    const nearOffRetained = { ...renderer.info.memory }
    const counts = runtime.diagnostics
    post.render(0)
    check(
      runtime.diagnostics.cloudUpdates === counts.cloudUpdates &&
        runtime.diagnostics.depthPasses === counts.depthPasses &&
        !material.uniforms.sceneCloudFarEnabled.value,
      'off clears maps and stops extra passes'
    )
    settings.showClouds = true
    draw()
    for (const quality of ['low', 'high', 'medium'] as const) {
      settings.cloudQuality = quality
      draw()
      check(runtime.diagnostics.effectiveWeight > 0, `${quality} fresh output`)
      phase(`${quality} quality fresh output`)
    }
    report.cases.push('quality-and-off')
    checkGL('quality switches')
    const ordinaryRender = renderer.render
    let injected = false
    renderer.render = function (activeScene, activeCamera) {
      if (!injected && activeScene === scene && mesh.material !== material) {
        const bad = mesh.material as ShaderMaterial
        bad.fragmentShader = '#error task7_deliberate_instance_failure\n' + bad.fragmentShader
        bad.needsUpdate = true
        injected = true
      }
      ordinaryRender.call(this, activeScene, activeCamera)
    }
    const start = Date.now()
    try {
      post.render(0)
    } finally {
      renderer.render = ordinaryRender
      drainShaderFailure('owned near deliberate link failure', start)
    }
    check(
      injected && runtime.diagnostics.effectiveWeight === 0 && runtime.diagnostics.reason === 'error',
      'bad near instance falls back'
    )
    const updates = runtime.diagnostics.cloudUpdates
    post.render(0)
    check(
      runtime.diagnostics.cloudUpdates === updates && runtime.diagnostics.effectiveWeight === 0,
      'cached failed program remains latched'
    )
    settings.cloudQuality = 'low'
    draw()
    check(mesh.material === material, 'exact material owner restored')
    report.cases.push('bad-instance-shader-retry')
    phase('owned-near retry completed')
    checkGL('owned near recovery')
    for (const { stage, duringMenu } of [
      { stage: 'depth', duringMenu: false },
      { stage: 'near', duringMenu: false },
      { stage: 'depth', duringMenu: true },
      { stage: 'near', duringMenu: true }
    ] as const) {
      const bad = new ShaderMaterial({
        transparent: stage === 'near',
        vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: '#error task7_nonselected_failure\nvoid main(){gl_FragColor=vec4(1.);}'
      })
      const badGeometry = new PlaneGeometry(0.2, 0.2),
        nonselected = new Mesh(badGeometry, bad)
      nonselected.position.z = 6400000 * unit
      scene.add(nonselected)
      const ordinary = renderer.render
      let observed = false
      renderer.render = function (activeScene, activeCamera) {
        ordinary.call(this, activeScene, activeCamera)
        if (
          !observed &&
          activeScene === scene &&
          (stage === 'depth' ? mesh.material === material : mesh.material !== material)
        ) {
          observed = true
          nonselected.visible = false
        }
      }
      const failureStart = Date.now()
      try {
        post.render(0)
      } finally {
        renderer.render = ordinary
        drainShaderFailure(`nonselected ${stage} deliberate link failure`, failureStart)
      }
      check(
        observed && runtime.diagnostics.effectiveWeight === 0 && runtime.diagnostics.reason === 'error',
        `nonselected ${stage} cannot publish near`
      )
      const depthCount = runtime.diagnostics.depthPasses,
        updates = runtime.diagnostics.cloudUpdates
      settings.cloudQuality = 'high'
      source.needsUpdate = true
      material.defines.UNRELATED_SELECTED_LAYOUT = 1
      material.needsUpdate = true
      post.render(0)
      runtime.resetHistory()
      runtime.resetScenario()
      post.render(0)
      check(
        runtime.diagnostics.effectiveWeight === 0 &&
          runtime.diagnostics.depthPasses === depthCount &&
          runtime.diagnostics.cloudUpdates === updates,
        `${stage} cached failure survives source/quality/selected layout/scenario changes`
      )
      scene.remove(nonselected)
      // Retain the failed material/program until the genuine context cache reset.
      await restoreContext(
        `${duringMenu ? 'menu ' : ''}nonselected ${stage}`,
        () => {
          bad.dispose()
          badGeometry.dispose()
        },
        duringMenu
      )
      settings.cloudQuality = 'low'
      draw()
      report.cases.push(
        duringMenu
          ? `menu-${stage}-context-recovery`
          : stage === 'depth'
            ? 'nonselected-depth-context-latch'
            : 'unknown-near-context-latch'
      )
    }
    // A same-ID bitmap mutation without a storage event must be detected before publication.
    deferred = true
    settings.cloudQuality = 'medium'
    post.render(0)
    source.image = { data: new Uint8Array([200, 200, 200, 255]), width: 1, height: 1 }
    source.needsUpdate = true
    const obsolete = ownedPrepared.at(-1)!
    finish!()
    await Promise.resolve()
    check(
      obsolete.disposed === 1 && runtime.diagnostics.effectiveWeight === 0,
      'stale new-bitmap completion disposed exactly once'
    )
    deferred = false
    draw()
    resourceStorage.deleteTexture('lifecycle-density')
    check(
      material.uniforms.sceneCloudMap.value === null && !material.uniforms.sceneCloudShadowEnabled.value,
      'eviction synchronously clears borrowed bindings'
    )
    post.render(0)
    check(runtime.diagnostics.effectiveWeight === 0, 'missing source holds far fallback')
    source = texture('lifecycle-density')
    draw()
    report.cases.push('source-eviction-reload', 'same-id-new-bitmap')
    // Independent scalar far color remains independently tracked while density preparation is pending.
    body.descriptor.far = {
      mapping: profile.mapping,
      pattern: {
        kind: 'mask',
        encoding: 'scalar',
        map: { resourceId: 26 },
        decode: { channel: 'r', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'encoded' }
      },
      color: { kind: 'map', map: { resourceId: 27 }, strength: 1 }
    }
    post.render(0)
    check(material.uniforms.sceneCloudColorMap.value === color, 'independent far color bound')
    resourceStorage.deleteTexture('lifecycle-color')
    check(material.uniforms.sceneCloudColorMap.value === null, 'independent far color clears before eviction disposal')
    color = texture('lifecycle-color', 64)
    draw()
    check(
      material.uniforms.sceneCloudColorMap.value === color && material.uniforms.sceneCloudColorMap.value !== source,
      'independent far color reload never substitutes density'
    )
    report.cases.push('independent-far-color')
    deferred = true
    settings.cloudQuality = 'high'
    post.render(0)
    const scenarioJob = ownedPrepared.at(-1)!
    post.dispose()
    stopReceiver()
    stopBody()
    finish!()
    await Promise.resolve()
    check(
      scenarioJob.disposed === 1 && runtime.diagnostics.effectiveWeight === 0,
      'scenario cancellation rejects ignored abort'
    )
    deferred = false
    stopBody = registry.register(body)
    stopReceiver = registry.bindReceiver(7, receiver)
    settings.cloudQuality = 'low'
    initialize()
    draw()
    report.cases.push('scenario-pending-cancellation')
    phase('source and pending scenario transitions completed')
    checkGL('source and scenario transitions')
    renderer.setPixelRatio(2)
    renderer.setSize(32, 18)
    post.setSize(32, 18)
    camera.aspect = 32 / 18
    camera.updateProjectionMatrix()
    draw()
    check(renderer.getDrawingBufferSize(new Vector2()).equals(new Vector2(64, 36)), 'physical DPR size')
    const beforeCapture = runtime.diagnostics.cloudUpdates
    const captureStart = performance.now()
    phase('3840x2160 capture begin')
    const blob = await post.captureScreenshot()
    const bitmap = blob ? await createImageBitmap(blob) : null
    check(bitmap?.width === 3840 && bitmap.height === 2160, 'actual screenshot pixels are 3840x2160')
    measurements.push({
      captureMs: performance.now() - captureStart,
      bytes: blob?.size,
      width: bitmap?.width,
      height: bitmap?.height
    })
    bitmap?.close()
    check(
      !!blob && blob.size > 0 && runtime.diagnostics.cloudUpdates === beforeCapture + 1,
      '4K one presentation without simulation update'
    )
    check(
      renderer.getPixelRatio() === 2 && renderer.getDrawingBufferSize(new Vector2()).equals(new Vector2(64, 36)),
      'capture restores CSS/DPR/targets'
    )
    check(
      JSON.stringify(backendSizes.at(-1)) === '[64,36]',
      'backend target dimensions restored before next normal draw'
    )
    check(
      runtime.diagnostics.effectiveWeight === 0 && !material.uniforms.sceneCloudShadowEnabled.value,
      'capture-era output invalidated immediately'
    )
    const originalPostRender = post.render
    post.render = () => {
      throw Error('task7 capture failure')
    }
    let captureFailed = false
    try {
      post.captureScreenshot()
    } catch (error) {
      captureFailed = String(error).includes('task7 capture failure')
    } finally {
      post.render = originalPostRender
    }
    check(
      captureFailed &&
        JSON.stringify(backendSizes.at(-1)) === '[64,36]' &&
        renderer.getPixelRatio() === 2 &&
        runtime.diagnostics.effectiveWeight === 0,
      'failed capture restores owned target sizes and history before next draw'
    )
    draw()
    report.cases.push('resize-dpr-4k-return')
    phase('3840x2160 success/failure targets restored')
    checkGL('3840x2160 capture and failure finally')
    await restoreContext('capture lifecycle')
    borrowedReadable(source)
    borrowedReadable(color)
    borrowedReadable(atmospheres.get(8)!.lut.transmittance)
    report.cases.push('webgl-loss-restore', 'borrowed-ownership')
    // Return to the same pre-cloud ownership baseline across repeated scenario lifetimes.
    renderer.setPixelRatio(1)
    renderer.setSize(16, 9)
    post.setSize(16, 9)
    camera.aspect = 16 / 9
    camera.updateProjectionMatrix()
    const cycles: unknown[] = []
    for (let i = 0; i < 3; i++) {
      draw()
      post.dispose()
      stopReceiver()
      stopBody()
      check(registry.entries().length === 0 && registry.receivers(7).length === 0, 'registrations released')
      stopBody = registry.register(body)
      stopReceiver = registry.bindReceiver(7, receiver)
      initialize()
      settings.showClouds = false
      post.render(0)
      cycles.push({ ...renderer.info.memory })
      check(
        renderer.info.memory.textures === baseline.textures,
        'owned texture baseline stable ' +
          JSON.stringify({ baseline, nearOffRetained, cycles, baselineTextures, currentTextures: allocated() })
      )
      settings.showClouds = true
      phase(`ownership cycle ${i + 1} stable`)
    }
    Object.assign(report, {
      baseline,
      baselineTextures,
      nearOffRetained,
      cycles,
      measurements,
      menuRecoveries,
      backendSizes,
      currentTextures: allocated(),
      borrowedColorUuid: color.uuid,
      glFlags: flags,
      phases
    })
    report.cases.push('stable-enter-leave')
    checkGL('final ownership cycles')
  } finally {
    post.dispose()
    runtime.dispose()
    stopReceiver()
    stopBody()
    receiver.dispose()
    atmosphere.dispose()
    material.dispose()
    geometry.dispose()
    shared.uniforms.map.value = null
    shared.dispose()
    sharedQuad.geometry.dispose()
    readTarget.dispose()
    resourceStorage.deleteAllTextures()
    renderer.render = actualDraw
    renderer.setRenderTarget = setTarget
    renderer.setRenderTarget(null)
    Object.assign(report, {
      expectedShaderFailureWindows: windows,
      memoryAfter: { ...renderer.info.memory },
      preparedDisposals: ownedPrepared.map((p) => p.disposed)
    })
    report.resourcesReleased = renderer.info.memory.textures === 0 && ownedPrepared.every((p) => p.disposed === 1)
    releaseStorageContext()
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return report
}
