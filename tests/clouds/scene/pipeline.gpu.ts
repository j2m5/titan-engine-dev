import {
  Camera,
  DataTexture,
  FloatType,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { Pass } from 'postprocessing'
import { OVERLAY_LAYER } from '@/core/graphic/passes/DepthVolume'
import { Actor } from '@/core/models/Actor'
import { createTestContainer } from '../../helpers/createTestContainer'
import { Tokens } from '@/core/providers/tokens'
import { createRenderer } from '@/core/graphic/renderingFactories'
import { CloudBlendPass } from '@/core/graphic/clouds/CloudBlendPass'
import { SceneCloudRuntime } from '@/core/clouds/SceneCloudRuntime'
import { prepareCloudSourceAsync } from '@/core/clouds/appearance/prepareCloudSourceAsync'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'
import { Storage } from '@/core/framework/file/Storage'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { SyncTerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { SpaceScale } from '@/core/constants'
import { readRenderingData } from '@/core/helpers/renderingData'
import { AtmosphereConfig, tintSolarIrradiance } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { adjustAtmosphereForTerrainFloor } from '@/core/renderables/Atmosphere/terrainFloorAdjust'
import { resolveLightTint } from '@/core/helpers/lightSource'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { captureAtmosphereFrame } from '@/core/graphic/effects/atmosphere/atmosphereFrame'
import type { AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import type { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'
import type { SceneCloudProbeReport } from './probe'
import jupiterUrl from '../../../src/labs/jupiter-clouds/assets/jupiter.jpg'
import earthUrl from '../../../src/labs/earth-clouds/assets/earth_clouds.jpg'
import { checkSamplerBudget } from './samplerBudget.gpu'

/** Observes actual inputBuffer before it is reused by the composer. No extra scene tick. */
class ObservePass extends Pass {
  constructor(private observe: (texture: Texture) => void) {
    super('PipelineObserve')
    this.needsSwap = false
    this.renderToScreen = false
  }
  override render(_renderer: WebGLRenderer, input: WebGLRenderTarget): void {
    this.observe(input.texture)
  }
}
export async function run(fixture: 'full' | 'ownership' = 'full'): Promise<SceneCloudProbeReport> {
  const report: SceneCloudProbeReport = {
    name: 'pipeline',
    checks: 0,
    maxError: 0,
    resourcesReleased: false,
    cases: []
  }
  const check = (value: boolean, label: string) => {
    if (!value) throw Error(label)
    report.checks++
  }
  const renderer = createRenderer({ logarithmicDepthBuffer: true, antialias: false }, 1)
  renderer.setSize(33, 33)
  Object.assign(report, { samplerBudget: checkSamplerBudget(renderer) })
  report.cases.push('full-material-sampler-budget')
  const observed = new Map<Texture, Set<string>>()
  const draw = renderer.render.bind(renderer)
  if (fixture === 'ownership')
    renderer.render = (scene, camera) => {
      scene.traverse((object) => {
        const material = (object as Mesh).material
        for (const item of Array.isArray(material) ? material : material ? [material] : []) {
          for (const [name, uniform] of Object.entries((item as ShaderMaterial).uniforms ?? {})) {
            const texture = uniform.value
            if (texture instanceof Texture) {
              let tags = observed.get(texture)
              if (!tags) {
                tags = new Set()
                observed.set(texture, tags)
              }
              tags.add(`${item.type}:${name}`)
            }
          }
        }
      })
      draw(scene, camera)
    }
  // The ring sampler borrows the application placeholder; it outlives scene teardown.
  renderer.initTexture(PlaceholderTexture.get())
  const borrowedTextureBaseline = renderer.info.memory.textures
  const readTarget = new WebGLRenderTarget(1, 1, { type: FloatType, depthBuffer: false })
  const readMaterial = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { map: { value: null } },
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'uniform sampler2D map;void main(){gl_FragColor=texture2D(map,vec2(.5));}'
  })
  const quad = new Mesh(new PlaneGeometry(2, 2), readMaterial),
    screen = new Scene()
  screen.add(quad)
  const sample = (texture: Texture) => {
    const previous = renderer.getRenderTarget()
    readMaterial.uniforms.map.value = texture
    renderer.setRenderTarget(readTarget)
    renderer.render(screen, new Camera())
    const bytes = new Float32Array(4)
    renderer.readRenderTargetPixels(readTarget, 0, 0, 1, 1, bytes)
    renderer.setRenderTarget(previous)
    return [...bytes]
  }
  const close = (a: number[], b: number[], label: string) =>
    a.forEach((value, i) => {
      const error = Math.abs(value - b[i])
      check(Number.isFinite(value) && error < 0.008, `${label}[${i}] ${value} != ${b[i]}`)
      report.maxError = Math.max(report.maxError, error)
    })
  const originalUrl = Storage.url
  const measurements: unknown[] = []
  try {
    const asymmetric = document.createElement('canvas')
    asymmetric.width = 1025
    asymmetric.height = 17
    const pixels = new Uint8ClampedArray(1025 * 17 * 4)
    for (let y = 0; y < 17; y++)
      for (let x = 0; x < 1025; x++) {
        const at = (y * 1025 + x) * 4
        pixels[at] = pixels[at + 1] = pixels[at + 2] = (x + y * 3) % 256
        pixels[at + 3] = 255
      }
    asymmetric.getContext('2d')!.putImageData(new ImageData(pixels, 1025, 17), 0, 0)
    const blob = await new Promise<Blob>((resolve) => asymmetric.toBlob((value) => resolve(value!), 'image/png'))
    const url = URL.createObjectURL(blob)
    Storage.url = () => url
    const bitmap = await ImageBitmapStrategy.create().load({
      paths: ['asymmetric.png'],
      name: 'asymmetric',
      params: {},
      resourceType: 'cloud'
    })
    Storage.url = originalUrl
    const versions = [bitmap.version, bitmap.source.version],
      image = bitmap.image
    const sync = prepareCloudSource(createEarthCloudProfile(), () => bitmap),
      async = await prepareCloudSourceAsync(createEarthCloudProfile(), () => bitmap)
    const a = sync.textures.weather.image.data as Uint8Array,
      b = async.textures.weather.image.data as Uint8Array
    check(
      a.length === b.length && a.every((value, i) => value === b[i]),
      'actual asymmetric tiled Bitmap equals sync native read'
    )
    check(b[0] === 111 && b[16 * 1025 * 4] === 0, 'known oriented nonlinear bitmap corners')
    check(
      bitmap.image === image && bitmap.version === versions[0] && bitmap.source.version === versions[1],
      'bitmap and source are immutable borrowed inputs'
    )
    sync.dispose()
    async.dispose()
    bitmap.dispose()
    ;(image as ImageBitmap).close()
    URL.revokeObjectURL(url)
    report.cases.push('async-tiled-bitmap-equivalence')
    // Equal HDR endpoint oracle: every weight preserves brightness before tone mapping.
    const equal = new DataTexture(new Float32Array([2, 1, 0.5, 1]), 1, 1)
    equal.type = FloatType
    equal.needsUpdate = true
    const input = new WebGLRenderTarget(1, 1, { type: FloatType }),
      output = input.clone(),
      equalBlend = new CloudBlendPass()
    const equalScene = new Scene(),
      equalMaterial = new ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader: 'void main(){gl_FragColor=vec4(2.,1.,.5,1.);}'
      })
    const equalQuad = new Mesh(new PlaneGeometry(2, 2), equalMaterial)
    equalScene.add(equalQuad)
    renderer.setRenderTarget(input)
    renderer.render(equalScene, new Camera())
    for (const weight of [0.25, 0.5, 0.75, 1]) {
      equalBlend.setNear(equal, weight)
      equalBlend.render(renderer, input, output)
      close(sample(output.texture), [2, 1, 0.5, 1], 'equal HDR brightness')
    }
    renderer.setRenderTarget(null)
    equalBlend.dispose()
    equal.dispose()
    input.dispose()
    output.dispose()
    equalMaterial.dispose()
    equalQuad.geometry.dispose()
    report.cases.push('equal-hdr-endpoints')
    for (const actorId of [7, 10]) {
      const container = createTestContainer(),
        scene = new Scene(),
        camera = new PerspectiveCamera(45, 1, 1e-6, 1.5e8)
      container.instance(Tokens.Renderer, renderer)
      container.instance(Tokens.Camera, camera)
      container.instance(Tokens.Scene, scene)
      container.instance(Tokens.TerrainPatchBuilder, new SyncTerrainPatchBuilder())
      const actor = Actor.find(actorId)!,
        paths = actor.resources
      const cloudResource = paths.find(actorId === 7 ? 26 : 32)!
      Storage.url = () => (actorId === 7 ? earthUrl : jupiterUrl)
      const loadStart = performance.now()
      const source = await ImageBitmapStrategy.create().load({
        paths: [cloudResource.getAttribute('path')!],
        name: cloudResource.getAttribute('path')!,
        params: {},
        resourceType: actorId === 7 ? 'cloud' : 'diffuse'
      })
      Storage.url = originalUrl
      if (fixture === 'ownership') {
        const original = source.image as ImageBitmap
        source.image = await createImageBitmap(original, 0, 0, 8, 4)
        original.close()
        source.needsUpdate = true
      }
      const loadMs = performance.now() - loadStart
      check(
        fixture === 'ownership' || (source.image.width === 8192 && source.image.height === 4096),
        'full native streamed source dimensions'
      )
      source.name = cloudResource.getAttribute('path')!
      resourceStorage.addTexture(source)
      for (const key of [
        '',
        'default.png',
        'night.jpg',
        paths.where('resourceType', 'diffuse').first()!.getAttribute('path')!
      ]) {
        if (resourceStorage.getTexture(key)) continue
        const texture = new Texture(source.image)
        texture.name = key
        texture.needsUpdate = true
        resourceStorage.addTexture(texture)
      }
      const registry = container.get(Tokens.CloudRegistry),
        atmospheres = container.get(Tokens.AtmosphereRegistry)
      const slices: number[] = [],
        native: number[] = [],
        allocation: number[] = [],
        stages: Record<string, number> = {}
      let completedAt = 0,
        firstActivationMs = 0
      const runtime = new SceneCloudRuntime(registry, {
        prepare: (config, resolve, options) =>
          prepareCloudSourceAsync(config, resolve, {
            ...options,
            measured: (stage, ms) => {
              if (stage === 'slice') slices.push(ms)
              else if (stage === 'native') native.push(ms)
              else if (stage === 'allocation') allocation.push(ms)
              else stages[stage] = ms
            }
          }).then((result) => {
            completedAt = performance.now()
            return result
          })
      })
      runtime.setOptions(true, 'low')
      container.instance(Tokens.SceneCloudRuntime, runtime)
      const factory = container.get(Tokens.RenderableFactory)
      const node = factory.make(actor) as DynamicNode
      scene.add(node)
      node.position.set(0, 0, -1000)
      const radius = actor.physicalObject!.getAttribute('radius')! * 1000,
        unit = SpaceScale / 1000
      const atmosphereActor = actor.children.where('categoryId', 5).first()!
      const authored = readRenderingData<AtmosphereConfig>(atmosphereActor)!
      const adjusted = adjustAtmosphereForTerrainFloor(authored, authored.terrainFloorMeters ?? 0)
      const config = {
        ...adjusted,
        solarIrradiance: tintSolarIrradiance(adjusted.solarIrradiance, resolveLightTint(atmosphereActor).color)
      }
      const generator = new AtmosphereLUTGenerator(renderer)
      const entry: AtmosphereEntry = {
        actorId: atmosphereActor.getAttribute('id')!,
        bodyActorId: actorId,
        generation: 0,
        ready: true,
        name: 'pipeline',
        object: node,
        config,
        lut: generator.generate(config)
      }
      atmospheres.register(entry)
      // Controlled foreground body with its own real LUTs; selected cloud insertion must remain in the rear slot.
      const foreground = new Object3D()
      foreground.position.copy(node.position).add(new Vector3(0, 0, (radius + 40000) * unit))
      foreground.updateMatrixWorld()
      const foregroundConfig = { ...config, bottomRadius: 2, topRadius: 2.2 }
      const foregroundGenerator = new AtmosphereLUTGenerator(renderer)
      const foregroundEntry: AtmosphereEntry = {
        actorId: -1000,
        bodyActorId: -1000,
        generation: 0,
        ready: true,
        name: 'foreground fixture',
        object: foreground,
        config: foregroundConfig,
        lut: foregroundGenerator.generate(foregroundConfig)
      }
      atmospheres.register(foregroundEntry)
      const post = container.get(Tokens.Postprocessing)
      check(post.cloudRuntime === runtime, 'DI uses selected registry/runtime')
      post.initialize()
      post.composer!.autoRenderToScreen = false
      for (const pass of post.composer!.passes) pass.renderToScreen = false
      const blend = post.composer!.passes.find((pass) => pass instanceof CloudBlendPass) as CloudBlendPass
      check(!!blend, 'main blend pass precedes shared HDR')
      let far: number[] = [],
        near: number[] = [],
        mixed: number[] = []
      post.composer!.addPass(
        new ObservePass((texture) => {
          far = sample(texture)
        }),
        8
      )
      post.composer!.addPass(
        new ObservePass((texture) => {
          mixed = sample(texture)
          if (blend.enabled) near = sample((blend.fullscreenMaterial as ShaderMaterial).uniforms.sceneCloudNear.value)
        }),
        10
      )
      const body = registry.entries()[0],
        profile = body.descriptor.volume!,
        top = profile.layers[0].baseAltitudeMeters + profile.layers[0].thicknessMeters
      const setDistance = (distance: number, x = 0) => {
        camera.position.copy(node.position).add(new Vector3(x, 0, (radius + top + distance) * unit))
        camera.lookAt(node.position)
        camera.updateMatrixWorld()
      }
      setDistance(profile.lod.cutoffDistanceMeters * 2)
      for (let i = 0; i < 3; i++) post.render(0)
      check(runtime.diagnostics.depthPasses === 0 && runtime.diagnostics.cloudUpdates === 0, 'w0 no depth/cloud warmup')
      const farBaseline: number[] = []
      for (let i = 0; i < 8; i++) {
        const t = performance.now()
        await new Promise(requestAnimationFrame)
        camera.position.x += unit
        post.render(0)
        farBaseline.push(performance.now() - t)
      }
      const stateBefore = runtime.diagnostics,
        positionBefore = camera.position.clone()
      setDistance(profile.lod.fullDistanceMeters)
      const selection = captureAtmosphereFrame(camera, atmospheres, 1)
      check(
        selection.slots.length === 2 &&
          selection.slots[0].entry === entry &&
          selection.slots[1].entry === foregroundEntry,
        'selected body occupies rear atmosphere slot before foreground'
      )
      report.cases.push('foreground-slot-insertion')
      const prepStart = performance.now(),
        intervals: number[] = [],
        longTasks: number[] = [],
        pendingIntervals: number[] = []
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration)
      })
      observer.observe({ type: 'longtask', buffered: false })
      let pendingFrames = 0,
        previous = prepStart
      do {
        await new Promise(requestAnimationFrame)
        const frameStart = performance.now()
        camera.position.x += unit
        post.render(0)
        if (runtime.diagnostics.effectiveWeight > 0 && !firstActivationMs)
          firstActivationMs = performance.now() - frameStart
        const now = performance.now()
        intervals.push(now - previous)
        if (runtime.diagnostics.state === 'preparing') {
          pendingIntervals.push(now - previous)
          pendingFrames++
          check(
            runtime.diagnostics.effectiveWeight === 0 &&
              runtime.diagnostics.depthPasses === stateBefore.depthPasses &&
              runtime.diagnostics.cloudUpdates === stateBefore.cloudUpdates &&
              runtime.diagnostics.shadowUpdates === stateBefore.shadowUpdates,
            'pending retains only far work'
          )
        }
        previous = now
        if (performance.now() - prepStart > 120000) throw Error('Preparation timed out')
      } while (runtime.diagnostics.state === 'preparing')
      observer.disconnect()
      const prepMs = completedAt - prepStart
      check(
        (fixture === 'ownership' || pendingFrames > 1) && camera.position.distanceTo(positionBefore) > 0,
        `real camera/far frame progression during preparation: ${actorId} frames${pendingFrames} slices${slices.length} ${JSON.stringify(runtime.diagnostics)}`
      )
      check(Math.max(...slices) < 50, `preparation slice long task ${Math.max(...slices)}ms`)
      check(Math.max(...native) < 50, 'native read is bounded')
      const activationStart = performance.now()
      post.render(0)
      const activationMs = performance.now() - activationStart
      check(
        runtime.diagnostics.effectiveWeight > 0,
        `fresh output activates near: ${JSON.stringify(runtime.diagnostics)}`
      )
      measurements.push({
        actorId,
        source: [source.image.width, source.image.height],
        loadMs,
        prepMs,
        pendingFrames,
        firstActivationMs,
        steadyFrameMs: activationMs,
        maxSlice: Math.max(...slices),
        maxNative: Math.max(...native),
        allocations: allocation,
        stages,
        longTasks,
        maxFrameInterval: Math.max(...intervals),
        maxPendingInterval: Math.max(...pendingIntervals),
        farBaseline,
        maxBaseline: Math.max(...farBaseline),
        peakCanonicalBytes: source.image.width * source.image.height * 4
      })
      for (const weight of [0.25, 0.5, 0.75, 1, 0]) {
        // Invert the authored smoothstep LOD; source/config and body generation remain fixed.
        let lo = 0,
          hi = 1
        for (let i = 0; i < 50; i++) {
          const t = (lo + hi) / 2
          if (1 - t * t * (3 - 2 * t) > weight) lo = t
          else hi = t
        }
        const distance =
          weight === 0
            ? profile.lod.cutoffDistanceMeters + 1000
            : weight === 1
              ? profile.lod.fullDistanceMeters - 1000
              : profile.lod.fullDistanceMeters +
                ((profile.lod.cutoffDistanceMeters - profile.lod.fullDistanceMeters) * (lo + hi)) / 2
        setDistance(distance)
        if (actorId === 7 && weight === 0.5) {
          heightFieldStorage['maps'].set(heightPathOf(actor)!, {
            width: 4,
            height: 2,
            minMeters: -1000,
            maxMeters: 1000,
            data: new Uint16Array(8).fill(32768)
          })
          check(factory.upgradePlanetToTerrain(node), 'production terrain/water upgrade')
          check(
            registry.entries()[0] === body && registry.receivers(actorId).length === 2,
            'surface swap retains body/source generation'
          )
          report.cases.push('terrain-water-main-composition')
        }
        const before = runtime.diagnostics
        post.render(0)
        const after = runtime.diagnostics
        check(after.finalRenders - before.finalRenders === 1, 'one final render')
        check(after.depthPasses - before.depthPasses === (weight > 0 ? 1 : 0), 'one eligible depth orchestration')
        check(
          after.cloudUpdates - before.cloudUpdates === (weight > 0 ? 1 : 0) &&
            after.shadowUpdates - before.shadowUpdates === (weight > 0 ? 1 : 0),
          `one public cloud/shadow update ${actorId}/${weight}: ${String(runtime.error)} ${JSON.stringify(after)}`
        )
        check(
          after.farRenders - before.farRenders === (weight < 1 ? 1 : 0) &&
            after.nearRenders - before.nearRenders === (weight > 0 ? 1 : 0),
          'exact far/near draw schedule'
        )
        if (weight > 0)
          close(
            mixed,
            weight === 1 ? near : far.map((v, i) => v * (1 - weight) + near[i] * weight),
            `main linear HDR mix ${actorId}/${weight}`
          )
        if (weight === 1) {
          if (actorId === 7) {
            const owner = registry.receivers(actorId)[0].getEndpointMaterial('far')
            const originalCompile = owner.onBeforeCompile
            const previousHandler = renderer.debug.onShaderError,
              previousCheck = renderer.debug.checkShaderErrors
            owner.onBeforeCompile = function (parameters, drawingRenderer) {
              originalCompile.call(this, parameters, drawingRenderer)
              if ((this as ShaderMaterial).defines.SCENE_CLOUD_NEAR)
                parameters.fragmentShader = 'invalid_near_receiver_token\n' + parameters.fragmentShader
            }
            owner.needsUpdate = true
            const start = Date.now()
            post.render(0)
            report.expectedShaderFailureWindows ??= []
            report.expectedShaderFailureWindows.push({ start, end: Date.now() + 1 })
            // Intentional invalid draw errors are confined to this demonstrated failure window.
            while (renderer.getContext().getError() !== 0) {
              /* drain intentional invalid-program errors */
            }
            check(
              runtime.diagnostics.reason === 'error' && runtime.diagnostics.effectiveWeight === 0,
              'receiver link failure rejects near capture'
            )
            check(
              String(runtime.error).includes('shader compilation failed'),
              'original receiver shader cause retained'
            )
            check(
              renderer.debug.onShaderError === previousHandler && renderer.debug.checkShaderErrors === previousCheck,
              'public shader observer restored'
            )
            const failed = runtime.diagnostics
            post.render(0)
            check(
              runtime.diagnostics.cloudUpdates === failed.cloudUpdates &&
                runtime.diagnostics.nearRenders === failed.nearRenders &&
                runtime.diagnostics.effectiveWeight === 0,
              'cached failed receiver stays latched far'
            )
            check(
              registry.receivers(actorId)[0].getEndpointMaterial('far') === owner,
              'failed receiver restores original owner'
            )
            owner.onBeforeCompile = originalCompile
            owner.needsUpdate = true
            const retryStart = performance.now()
            while (runtime.diagnostics.effectiveWeight === 0 && performance.now() - retryStart < 90000) {
              await new Promise(requestAnimationFrame)
              post.render(0)
            }
            check(
              runtime.diagnostics.effectiveWeight > 0 && runtime.diagnostics.reason === null,
              'genuine owner layout retry obtains a valid near program'
            )
            report.cases.push('receiver-link-failure-recovery')
          }
          const originalRender = renderer.render.bind(renderer)
          let injected = false
          renderer.render = (drawScene, drawCamera) => {
            if (
              !injected &&
              drawScene === scene &&
              runtime.diagnostics.state === 'active' &&
              drawCamera.layers.mask === 1 << OVERLAY_LAYER
            ) {
              injected = true
              throw Error('injected near endpoint failure')
            }
            originalRender(drawScene, drawCamera)
          }
          try {
            post.render(0)
          } finally {
            renderer.render = originalRender
          }
          check(
            injected && runtime.diagnostics.reason === 'error' && runtime.diagnostics.effectiveWeight === 0,
            'near failure becomes far fallback'
          )
          check(
            camera.layers.mask === 1 && renderer.shadowMap.autoUpdate,
            'near overlay failure restores camera and renderer draw state'
          )
          const material = (node.renderable as unknown as { material: ShaderMaterial }).material
          check(
            material.uniforms.sceneCloudFarEnabled.value === (body.descriptor.far !== null) &&
              material.uniforms.sceneCloudShadowEnabled.value === false,
            'near failure restores receiver far and clears shadow'
          )
          report.cases.push('near-failure-restoration')
        }
      }
      report.cases.push(actorId === 7 ? 'earth-main-composition' : 'jupiter-main-composition')
      // Unsupported lens and unavailable selected slot keep a valid far frame.
      const lens = container.get(Tokens.LensRegistry),
        lensObject = new Object3D()
      lens.register({ object: lensObject, rsUnits: 1, simulationRadiusUnits: 1, background: () => null })
      setDistance(profile.lod.fullDistanceMeters - 1000)
      const before = runtime.diagnostics
      post.render(0)
      check(
        runtime.diagnostics.depthPasses === before.depthPasses && runtime.diagnostics.reason === 'lens',
        'lens fallback has no volume work'
      )
      lens.unregister(lens.entries()[0])
      entry.ready = false
      post.render(0)
      check(
        runtime.diagnostics.reason === 'atmosphere' && runtime.diagnostics.effectiveWeight === 0,
        'missing slot fallback'
      )
      report.cases.push('far-fallback', 'responsive-large-source')
      renderer.setRenderTarget(null)
      post.dispose()
      runtime.dispose()
      registry.clear()
      disposeSceneTree(node)
      generator.dispose()
      foregroundGenerator.dispose()
      heightFieldStorage.clear()
      resourceStorage.deleteAllTextures()
      ;(source.image as ImageBitmap).close()
    }
    Object.assign(report, { measurements })
    report.cases.push('linear-hdr-mix', 'single-frame-schedule')
    check(renderer.getContext().getError() === 0, 'no GL error')
  } finally {
    Storage.url = originalUrl
    resourceStorage.deleteAllTextures()
    readMaterial.uniforms.map.value = null
    readMaterial.dispose()
    quad.geometry.dispose()
    readTarget.dispose()
    renderer.setRenderTarget(null)
    const remaining = [...observed]
      .filter(([texture]) => (renderer.properties.get(texture) as { __webglTexture?: WebGLTexture }).__webglTexture)
      .map(([texture, tags]) => ({ name: texture.name, type: texture.type, uuid: texture.uuid, tags: [...tags] }))
    Object.assign(report, { memoryAfter: { ...renderer.info.memory }, borrowedTextureBaseline, remaining })
    report.resourcesReleased = renderer.info.memory.textures === borrowedTextureBaseline
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return report
}
