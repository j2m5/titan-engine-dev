import {
  Camera,
  Color,
  DataTexture,
  FloatType,
  Mesh,
  NoBlending,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget
} from 'three'
import type { CloudsEffect } from '@takram/three-clouds'
import { ShaderPass } from 'postprocessing'
import { createRenderer } from '@/core/graphic/renderingFactories'
import { SpaceScale } from '@/core/constants'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { EMPTY_LAYER, expLayer, type AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { AtmosphereRegistry, type AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { AtmosphereEffect } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import { buildAtmosphereEffectFragment } from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'
import { captureAtmosphereFrame } from '@/core/graphic/effects/atmosphere/atmosphereFrame'
import { SceneCloudBackend } from '@/core/clouds/takram/SceneCloudBackend'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import { SphereSurfaceMaterial } from '@/core/materials/SphereSurfaceMaterial'
import type { Actor } from '@/core/models/Actor'
import type { SceneCloudProbeReport } from './probe'
import { checkSceneCloudTemporalResolve } from './temporalResolve.gpu'

const SIZE = 33,
  UNIT = SpaceScale / 1000,
  RADIUS = 6371000
const NORMALIZATION = 'radianceIntegral *= sceneCloudTargetWhite / sceneCloudReferenceWhite;'

export async function run(): Promise<SceneCloudProbeReport> {
  const report: SceneCloudProbeReport = {
    name: 'lighting',
    checks: 0,
    maxError: 0,
    resourcesReleased: false,
    cases: []
  }
  const renderer = createRenderer({ logarithmicDepthBuffer: true, antialias: false }, 1)
  renderer.setSize(SIZE, SIZE)
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw Error(
      `lighting shader: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`
    )
  }
  const originalHandler = renderer.debug.onShaderError
  const owned: Array<{ dispose(): void }> = []
  let backend: SceneCloudBackend | null = null
  const generator = new AtmosphereLUTGenerator(renderer)
  const center = new Vector3(0, 0, -1000),
    object = new Object3D()
  object.position.copy(center)
  object.updateMatrixWorld()
  const camera = new PerspectiveCamera(45, 1, 1e-6, 1.5e8)
  const input = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType })
  const readTarget = new WebGLRenderTarget(1, 1, { type: FloatType, depthBuffer: false })
  const geometry = new PlaneGeometry(2, 2),
    screen = new Scene()
  const readMaterial = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'void main(){gl_FragColor=vec4(0.);}'
  })
  screen.add(new Mesh(geometry, readMaterial))
  owned.push(input, readTarget, geometry, readMaterial)
  const white = new DataTexture(new Uint8Array(4 * 4 * 2).fill(255), 4, 2)
  white.needsUpdate = true
  const depthValues = new Float32Array([1])
  const depth = new DataTexture(depthValues, 1, 1, RedFormat, FloatType)
  depth.needsUpdate = true
  owned.push(white, depth)
  // Public passes share a fullscreen triangle. Measure that baseline before owned uploads.
  const warmup = new ShaderPass(
    new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: 'void main(){gl_FragColor=vec4(0.);}'
    })
  )
  warmup.initialize(renderer, false, FloatType)
  warmup.render(renderer, null, input)
  warmup.dispose()
  const sharedGeometryBaseline = renderer.info.memory.geometries
  const prepared = prepareCloudSource(createEarthCloudProfile(), () => white)
  owned.push(prepared)
  const registry = new AtmosphereRegistry()
  let serial = 0
  let lastHistoryGeneration = -1
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
    muSMin: -0.2,
    exposure: 1.4,
    hdrKnee: 0.5
  }
  const entry: AtmosphereEntry = {
    actorId: 2,
    bodyActorId: 1,
    name: 'fixture',
    object,
    config,
    lut: generator.generate(config),
    generation: 0,
    ready: true
  }
  registry.register(entry)
  let borrowedDisposals = 0
  const borrowed = [
    entry.lut.transmittance,
    entry.lut.scattering,
    entry.lut.irradiance,
    prepared.textures.weather,
    white
  ]
  if (prepared.textures.color) borrowed.push(prepared.textures.color)
  const borrowedDisposed = (): void => {
    borrowedDisposals++
  }
  borrowed.forEach((texture) => texture.addEventListener('dispose', borrowedDisposed))
  const atmosphere = new AtmosphereEffect(camera, registry)
  owned.push(atmosphere)

  const check = (condition: boolean, label: string): void => {
    if (!condition) throw Error(label)
    report.checks++
  }
  const within = (actual: readonly number[], expected: readonly number[], tolerance = 0.002): boolean =>
    actual.every(
      (value, i) =>
        Number.isFinite(value) && Math.abs(value - expected[i]) <= Math.max(tolerance, Math.abs(expected[i]) * 0.001)
    )
  const unchanged = (actual: readonly number[], expected: readonly number[], label: string): void => {
    actual.forEach((value, index) =>
      check(Number.isFinite(value) && value === expected[index], `${label}[${index}]: ${value} != ${expected[index]}`)
    )
  }
  const close = (actual: readonly number[], expected: readonly number[], label: string, tolerance = 0.002): void => {
    actual.forEach((value, i) => {
      const error = Math.abs(value - expected[i])
      if (!Number.isFinite(error) || error > Math.max(tolerance, Math.abs(expected[i]) * 0.001))
        throw Error(`${label}[${i}]: ${value} != ${expected[i]} (error ${error})`)
      report.maxError = Math.max(report.maxError, error)
      report.checks++
    })
  }
  const draw = (fragment: string, uniforms: ShaderMaterial['uniforms']): number[] => {
    readMaterial.fragmentShader = fragment
    // Three caches the program's uniform list, including the individual Uniform objects.
    for (const [name, uniform] of Object.entries(uniforms)) {
      if (readMaterial.uniforms[name]) readMaterial.uniforms[name].value = uniform.value
      else readMaterial.uniforms[name] = { value: uniform.value }
    }
    readMaterial.needsUpdate = true
    renderer.setRenderTarget(readTarget)
    renderer.render(screen, new Camera())
    const pixels = new Float32Array(4)
    renderer.readRenderTargetPixels(readTarget, 0, 0, 1, 1, pixels)
    return [...pixels]
  }
  const sample = (texture: Texture, array = false): number[] =>
    draw(
      array
        ? 'precision highp sampler2DArray;uniform sampler2DArray map;void main(){gl_FragColor=texture(map,vec3(.5,.5,0.));}'
        : 'uniform sampler2D map;void main(){gl_FragColor=texture2D(map,vec2(.5));}',
      { map: { value: texture } }
    )
  const frame = (
    origin: Vector3,
    endpoint: Vector3,
    sun = new Vector3(0, 0, 1),
    light = new Color(1, 1, 1)
  ): CloudFrame => {
    camera.position.copy(center).addScaledVector(origin, UNIT)
    camera.lookAt(center.clone().addScaledVector(endpoint, UNIT))
    camera.updateMatrixWorld()
    const local = camera.clone(false)
    local.position.copy(origin)
    local.near = camera.near / UNIT
    local.far = camera.far / UNIT
    local.updateProjectionMatrix()
    local.updateMatrixWorld()
    return {
      serial: ++serial,
      deltaSeconds: 0,
      actorId: 1,
      camera: local,
      sceneCamera: camera,
      centerWorld: center.clone(),
      planetRotation: new Quaternion(),
      datumRadiusMeters: RADIUS,
      viewport: new Vector2(SIZE, SIZE),
      sunDirection: sun.clone(),
      lightColor: light.clone(),
      lambert: 0.8
    }
  }
  const activeEffect = (): CloudsEffect => (backend as unknown as { effect: CloudsEffect }).effect
  const recreate = (f: CloudFrame): CloudsEffect => {
    backend?.dispose()
    backend = new SceneCloudBackend(f, entry, prepared, 'terrestrial', 'low')
    const effect = activeEffect()
    // Fixture target size keeps real current/resolve draws small; production quality remains unchanged.
    effect.shadowMaps.mapSize.set(32, 32)
    return effect
  }
  const render = (f: CloudFrame): number[] => {
    const output = backend!.render(
      renderer,
      input,
      f,
      {
        texture: depth,
        sceneLogFarFactor: Math.log2(camera.far + 1),
        sceneUnitsToMeters: 1 / UNIT,
        viewport: f.viewport,
        serial: f.serial
      },
      entry
    )
    check(renderer.debug.onShaderError === originalHandler, 'renderer error handler restored')
    check(
      prepared.config.layers[0].castsShadow || output.shadow === null,
      'noncasting layer publishes no external shadow'
    )
    lastHistoryGeneration = output.historyGeneration
    return sample(output.overlay)
  }
  const diagnostics = (effect: CloudsEffect, body: string): void => {
    const material = effect.cloudsPass.currentMaterial
    const source = material.fragmentShader
    const marker = 'void main() {'
    check(source.split(marker).length === 2, 'unique pinned current main')
    material.fragmentShader =
      source.slice(0, source.indexOf(marker)) +
      `
uniform vec3 sceneProbeOrigin;
uniform vec3 sceneProbeEndpoint;
void main() {
  vec4 color = vec4(.1,.2,.3,.4);
  ${body}
  outputColor = color;
  outputDepthVelocity = vec3(1000.,0.,0.);
}`
    material.needsUpdate = true
  }
  const setEndpoints = (effect: CloudsEffect, origin: Vector3, endpoint: Vector3): void => {
    effect.cloudsPass.currentMaterial.uniforms.sceneProbeOrigin = new Uniform(origin)
    effect.cloudsPass.currentMaterial.uniforms.sceneProbeEndpoint = new Uniform(endpoint)
  }
  const aerialCall = 'applyAerialPerspective(sceneProbeOrigin, sceneProbeEndpoint, 0.0, color);'
  try {
    // Independent actual main SphereSurfaceMaterial at white datum/noon, before aerial/AgX.
    const empty = { first: () => undefined, isNotEmpty: () => false }
    const model = {
      getAttribute: (_key: string, fallback: unknown) => fallback,
      physicalObject: { getAttribute: () => 6371 },
      renderingObject: { getAttribute: () => ({ emission: 1, terrainLambert: 0.8, regolithMix: 0 }) },
      children: { where: () => empty },
      resources: { where: () => empty, first: () => undefined }
    } as unknown as Actor
    const surface = new SphereSurfaceMaterial(model)
    const sphereGeometry = new SphereGeometry(RADIUS * UNIT, 64, 32)
    const surfaceScene = new Scene(),
      mesh = new Mesh(sphereGeometry, surface)
    mesh.position.copy(center)
    surfaceScene.add(mesh)
    owned.push(surface, sphereGeometry)
    surface.uniforms.diffuseMap.value = white
    surface.uniforms.uTerrainLambert.value = 0.8
    surface.uniforms.emission.value = 1
    surface.defines.USE_LIGHT_TINT = '1'
    surface.needsUpdate = true
    const origin = new Vector3(0, 0, RADIUS + 50000),
      endpoint = new Vector3(0, 0, RADIUS + 6000)

    // Exercise the actual resolve's clipping kernel. Changing RGB must not pull
    // opacity toward the current frame, while opacity still rejects stale edges.
    const temporal = recreate(frame(origin, endpoint)).cloudsPass.resolveMaterial.fragmentShader
    const alphaKernel = temporal.match(/vec4 clipAABB\([^]*?\n\}/)?.[0]
    check(!!alphaKernel, 'pinned temporal resolve exposes one clipping kernel')
    for (const [rgb, alpha, expectedRgb, expectedAlpha] of [
      [0.3, 0.5, 0.3, 0.5],
      [0.9, 0.5, 0.4, 0.5],
      [0.0, 0.5, 0.2, 0.5],
      [0.3, 0.9, 0.3, 0.6],
      [0.9, 0.1, 0.4, 0.2]
    ]) {
      const actual = draw(
        `${alphaKernel}\nvoid main(){gl_FragColor=clipAABB(vec4(.3,.3,.3,.4),
          vec4(${rgb.toFixed(1)},${rgb.toFixed(1)},${rgb.toFixed(1)},${alpha.toFixed(1)}),
          vec4(.2,.2,.2,.2),vec4(.4,.4,.4,.6));}`,
        {}
      )
      close(actual, [expectedRgb, expectedRgb, expectedRgb, expectedAlpha], 'independent temporal opacity', 1e-6)
    }
    report.cases.push('temporal-opacity-independent-of-light')
    checkSceneCloudTemporalResolve(renderer, close)
    report.cases.push('temporal-fresh-pixel-accumulation')

    // Compare the production source-light function with an independently rendered
    // original far receiver. The same owner supplies all live policy values.
    const farReceiver = surface.sceneCloudReceiver
    const profile = createEarthCloudProfile()
    const pattern = profile.layers[0].pattern
    if (pattern.kind !== 'mask') throw new Error('Earth reference requires its authored map')
    farReceiver.setFarMap({ pattern, mapping: profile.mapping, color: profile.layers[0].color }, white)
    const sourceSample = (
      mu: number,
      tau: number,
      phase: number,
      visibility = 1,
      lambert = 1,
      albedo = new Vector3(1, 1, 1),
      tinted = false,
      physicalControl = false,
      skyStrength = 0.6
    ): { value: number[]; far: number[] } => {
      const f = frame(
        origin,
        endpoint,
        new Vector3(Math.sqrt(Math.max(0, 1 - mu * mu)), 0, mu),
        new Color(0.6, 0.8, 0.3)
      )
      f.lambert = lambert
      surface.uniforms.sceneCloudAmbient.value = 0.15
      surface.uniforms.sceneCloudAmbientSunRef.value = 0.3
      if (tinted) {
        surface.defines.USE_SUN_TINT = 1
        surface.defines.USE_SKY_AMBIENT = 1
        Object.assign(surface.uniforms, {
          uAtmoTransmittance: new Uniform(entry.lut.transmittance),
          uAtmoIrradiance: new Uniform(entry.lut.irradiance),
          uAtmoBottomRadius: new Uniform(entry.config.bottomRadius),
          uAtmoTopRadius: new Uniform(entry.config.topRadius),
          uAtmoDatumRadius: new Uniform(RADIUS * 0.001),
          uAtmoSunAngularRadius: new Uniform(entry.config.sunAngularRadius),
          uSunTintStrength: new Uniform(0.7),
          uSkyAmbientStrength: new Uniform(skyStrength)
        })
      } else {
        delete surface.defines.USE_SUN_TINT
        delete surface.defines.USE_SKY_AMBIENT
      }
      surface.needsUpdate = true
      farReceiver.setEndpoint(f, null)
      f.sceneLight = farReceiver.getLightSettings!()
      renderer.setRenderTarget(input)
      renderer.clear()
      renderer.render(surfaceScene, camera)
      const far = sample(input.texture).slice(0, 3)
      const renderFrame = physicalControl ? { ...f, sceneLight: undefined } : f
      const effect = recreate(renderFrame)
      const physicalShader = effect.cloudsPass.currentMaterial.fragmentShader
      const normalizationStart = physicalShader.indexOf('vec3 sceneCloudTargetWhite =')
      const normalizationStop = physicalShader.indexOf(NORMALIZATION, normalizationStart) + NORMALIZATION.length
      if (physicalControl) check(normalizationStart >= 0, 'negative control uses actual physical conversion')
      diagnostics(
        effect,
        physicalControl
          ? `vec3 sky;
        vec3 sun = getCloudsSunSkyIrradiance(sceneProbeEndpoint, 6000.0, sky);
        vec3 radianceIntegral = sun * approximateMultipleScattering(${tau.toFixed(6)}, ${phase.toFixed(6)})
          + sky * RECIPROCAL_PI4 * skyLightScale;
        ${physicalShader.slice(normalizationStart, normalizationStop)}
        color = vec4(radianceIntegral, .4);`
          : `float attenuation = approximateMultipleScattering(${tau.toFixed(6)}, ${phase.toFixed(6)})
        / max(approximateMultipleScattering(0.0, ${phase.toFixed(6)}), 1e-6);
        color = vec4(sceneCloudReferenceLight(dot(normalize(sceneProbeEndpoint), sunDirection), attenuation, 1.0, vec3(${visibility.toFixed(6)}))
          * vec3(${albedo.x.toFixed(6)}, ${albedo.y.toFixed(6)}, ${albedo.z.toFixed(6)}), .4);`
      )
      setEndpoints(effect, origin, endpoint)
      return { value: render(renderFrame), far }
    }
    const physicalControl = sourceSample(0.6, 0, -0.7, 1, 1, new Vector3(1, 1, 1), false, true)
    check(
      !within(physicalControl.value.slice(0, 3), physicalControl.far),
      `old physical source fails actual far envelope: ${JSON.stringify(physicalControl)}`
    )
    console.info('scene-reference physical negative control', JSON.stringify(physicalControl))
    report.cases.push('scene-reference-physical-negative-control')
    const skyDisabled = sourceSample(0.6, 0, -0.7, 1, 1, new Vector3(1, 1, 1), true, false, 0)
    const skyNegative = sourceSample(0.6, 0, -0.7, 1, 1, new Vector3(1, 1, 1), true, false, -0.5)
    close(skyNegative.far, skyDisabled.far, 'nonpositive owner sky strength preserves original disabled far mixing')
    close(skyNegative.value, skyDisabled.value, 'nonpositive owner sky strength preserves disabled source mixing')
    report.cases.push('scene-reference-nonpositive-sky-strength')
    for (const lambert of [0, 0.4, 1])
      for (const mu of [-1, -0.05, 0, 0.6, 1])
        for (const phase of [-0.7, 0.8]) {
          const actual = sourceSample(mu, 0, phase, 1, lambert)
          close(
            actual.value.slice(0, 3),
            actual.far,
            `scene reference unshadowed far envelope mu${mu}/L${lambert}/phase${phase}`
          )
          close(actual.value.slice(3), [0.4], 'source-light alpha untouched')
        }
    for (const phase of [-0.7, 0.8]) {
      let previous = sourceSample(0.6, 0, phase).value
      for (const tau of [0.5, 2, 10]) {
        const actual = sourceSample(0.6, tau, phase).value
        check(
          actual.slice(0, 3).every((v, i) => v <= previous[i] + 0.002 && v >= 0),
          'sun optical depth only attenuates calibrated direct light'
        )
        close(actual.slice(3), [0.4], 'optical-depth light policy preserves alpha')
        previous = actual
      }
    }
    close(sourceSample(-1, 0, -0.7).value.slice(0, 3), [0, 0, 0], 'night has no unconditional white floor')
    close(
      sourceSample(0.6, 0, -0.7, 0).value.slice(0, 3),
      [0, 0, 0],
      'eclipse multiplies complete scene cloud light, never phase reference'
    )
    const whiteSource = sourceSample(0.6, 0, -0.7).value
    const coloredSource = sourceSample(0.6, 0, -0.7, 1, 1, new Vector3(0.2, 0.5, 0.8)).value
    close(
      coloredSource.slice(0, 3),
      whiteSource.slice(0, 3).map((v, i) => v * [0.2, 0.5, 0.8][i]),
      'source albedo retains its authored linear multiplier'
    )
    const tinted = sourceSample(0.6, 0, -0.7, 1, 1, new Vector3(1, 1, 1), true)
    close(tinted.value.slice(0, 3), tinted.far, 'current far owner tint/LUT geometry matches calibrated source')
    report.cases.push(
      'scene-reference-white-limit',
      'scene-reference-optical-depth',
      'scene-reference-night-eclipse',
      'scene-reference-albedo-alpha',
      'scene-reference-owner-tint'
    )
    farReceiver.setFarMap(null, null)
    delete surface.defines.USE_SUN_TINT
    delete surface.defines.USE_SKY_AMBIENT
    surface.needsUpdate = true

    // A giant profile keeps the existing physical branch even if a main receiver
    // snapshot is present. Standalone labs keep their own adapter unchanged.
    {
      const f = frame(origin, endpoint)
      f.sceneLight = farReceiver.getLightSettings!()
      ;(backend as SceneCloudBackend | null)?.dispose()
      backend = new SceneCloudBackend(f, entry, prepared, 'giant', 'low')
      const effect = activeEffect()
      effect.shadowMaps.mapSize.set(32, 32)
      const shader = effect.cloudsPass.currentMaterial.fragmentShader
      const start = shader.indexOf('vec3 sceneCloudTargetWhite =')
      const stop = shader.indexOf(NORMALIZATION, start) + NORMALIZATION.length
      check(start >= 0 && stop > start, 'giant retains physical-unit normalization')
      diagnostics(
        effect,
        `vec3 sky; vec3 radianceIntegral = GetSunAndSkyIrradiance(vec3(0.,0.,sceneCloudDatumKm), vec3(0.,0.,1.), vec3(0.,0.,1.), sky) / PI;
        ${shader.slice(start, stop)} color = vec4(radianceIntegral, .4);`
      )
      setEndpoints(effect, origin, endpoint)
      close(render(f), [0.99, 0.99, 0.99, 0.4], 'giant physical branch remains unchanged with main owner snapshot')
      report.cases.push('giant-physical-source')
    }

    for (const [label, light] of [
      ['white-star', new Color(1, 1, 1)],
      ['colored-star', new Color(0.6, 0.8, 0.3)]
    ] as const) {
      entry.config.solarIrradiance = [1.474 * light.r, 1.8504 * light.g, 1.91198 * light.b]
      entry.lut = generator.generate(entry.config)
      registry.markReady(entry.actorId)
      const f = frame(origin, endpoint, new Vector3(0, 0, 1), light)
      surface.uniforms.uLightColor.value.copy(light)
      renderer.setRenderTarget(input)
      renderer.clear()
      renderer.render(surfaceScene, camera)
      const mainWhite = sample(input.texture).slice(0, 3)
      close(
        mainWhite,
        [Math.min(0.99, 0.2 + 0.8 * light.r), Math.min(0.99, 0.2 + 0.8 * light.g), Math.min(0.99, 0.2 + 0.8 * light.b)],
        `${label} actual datum white`
      )
      const effect = recreate(f)
      // Ground irradiance overload independently generates the physical Lambert reference.
      // Insert only a controlled raw integral; retain the adapter's normalization block verbatim.
      const shader = effect.cloudsPass.currentMaterial.fragmentShader
      const start = shader.indexOf('vec3 sceneCloudTargetWhite =')
      const stop = shader.indexOf(NORMALIZATION, start) + NORMALIZATION.length
      check(start >= 0 && stop > start, 'normalization hook present')
      const normalization = shader.slice(start, stop)
      const body = `vec3 sky;
        vec3 radianceIntegral = GetSunAndSkyIrradiance(vec3(0.,0.,sceneCloudDatumKm), vec3(0.,0.,1.), vec3(0.,0.,1.), sky) / PI;
        ${normalization}
        color = vec4(radianceIntegral, .4);`
      diagnostics(effect, body)
      setEndpoints(effect, origin, endpoint)
      for (let i = 0; i < 2; i++)
        close(render(f).slice(0, 3), mainWhite, `${label} ${i ? 'resolved' : 'fresh'} normalized reference`)
      for (const mode of ['omit', 'double']) {
        const control = recreate(f)
        diagnostics(control, body.replace(NORMALIZATION, mode === 'omit' ? '' : `${NORMALIZATION}\n${NORMALIZATION}`))
        setEndpoints(control, origin, endpoint)
        const wrong = render(f)
        check(
          !within(wrong.slice(0, 3), mainWhite),
          `${mode} normalization negative control fails same datum comparison: ${wrong}`
        )
      }
      report.cases.push(label)
    }

    // Rebind white LUTs for endpoint parity with the actual generated main slot shader.
    entry.config.solarIrradiance = [1.474, 1.8504, 1.91198]
    entry.lut = generator.generate(entry.config)
    registry.markReady(entry.actorId)
    const poses = [
      { name: 'zenith', origin: new Vector3(0, 0, RADIUS + 50000), endpoint: new Vector3(0, 0, RADIUS + 6000) },
      {
        name: 'limb',
        origin: new Vector3(0, 0, RADIUS + 50000),
        endpoint: new Vector3(700000, 0, Math.sqrt((RADIUS + 6000) ** 2 - 700000 ** 2))
      },
      { name: 'near-bottom', origin: new Vector3(0, 0, RADIUS + 2000), endpoint: new Vector3(0, 0, RADIUS + 5) }
    ]
    for (const bottom of [6371, 6360]) {
      entry.config.bottomRadius = bottom
      entry.lut = generator.generate(entry.config)
      registry.markReady(entry.actorId)
      for (const pose of poses) {
        const f = frame(pose.origin, pose.endpoint)
        const distanceUnits = pose.origin.distanceTo(pose.endpoint) * UNIT
        depthValues[0] = Math.log2(distanceUnits + 1) / Math.log2(camera.far + 1)
        depth.needsUpdate = true
        atmosphere.setFrame(captureAtmosphereFrame(camera, registry, f.serial))
        atmosphere.setCloudOverlay(null)
        atmosphere.update(renderer, input)
        const uniforms = Object.fromEntries(atmosphere.uniforms)
        uniforms.depthBuffer = new Uniform(depth)
        const expected = draw(
          `uniform sampler2D depthBuffer;\n${buildAtmosphereEffectFragment()}\nvoid main(){vec4 result; mainImage(vec4(.25,.5,.75,1.),vec2(.5),result);gl_FragColor=result*.4;}`,
          uniforms
        )
        const effect = recreate(f)
        check(
          effect.cloudLayers[0].altitude === RADIUS - bottom * 1000 + 4000,
          'layer altitude uses datum minus LUT bottom'
        )
        diagnostics(effect, aerialCall)
        setEndpoints(effect, pose.origin, pose.endpoint)
        for (let i = 0; i < 2; i++) close(render(f), expected, `${pose.name}/${bottom}/${i ? 'resolved' : 'fresh'}`)
        if (pose.name === 'limb') {
          for (const mode of ['omit', 'double']) {
            const control = recreate(f)
            diagnostics(control, mode === 'omit' ? '' : `${aerialCall}\n${aerialCall}`)
            setEndpoints(control, pose.origin, pose.endpoint)
            const wrong = render(f)
            check(
              !within(wrong.slice(0, 3), expected.slice(0, 3)),
              `${mode} aerial negative control fails same limb comparison: ${wrong}`
            )
          }
        }
      }
    }
    report.cases.push(
      'zenith',
      'limb',
      'near-bottom',
      'datum-bottom-offset',
      'fixed-alpha-aerial',
      'negative-controls',
      'fresh-resolved'
    )

    // A nearer atmosphere must process the cloud overlay after its selected far slot.
    const foreground = new Object3D()
    foreground.position.copy(center).add(new Vector3(0, 0, 15000 * SpaceScale))
    foreground.updateMatrixWorld()
    registry.register({ ...entry, actorId: 3, name: 'foreground-fixture', object: foreground })
    const compositionFrame = frame(new Vector3(0, 0, RADIUS + 20000000), new Vector3())
    depthValues[0] = 1
    depth.needsUpdate = true
    const overlay = new DataTexture(new Float32Array([0.1, 0.2, 0.3, 0.4]), 1, 1)
    overlay.type = FloatType
    overlay.needsUpdate = true
    owned.push(overlay)
    atmosphere.setFrame(captureAtmosphereFrame(camera, registry, compositionFrame.serial))
    atmosphere.setCloudOverlay({
      frame: compositionFrame,
      atmosphereActorId: entry.actorId,
      atmosphereGeneration: entry.generation,
      atmosphereBottomRadiusMeters: entry.config.bottomRadius * 1000,
      historyGeneration: 0,
      overlay,
      shadow: null,
      stbn: activeEffect().stbnTexture!
    })
    atmosphere.update(renderer, input)
    check(atmosphere.uniforms.get('sceneCloudSlot')!.value === 0, 'selected atmosphere is the far slot')
    const compositionUniforms = { ...Object.fromEntries(atmosphere.uniforms), depthBuffer: new Uniform(depth) }
    const slotShader = `uniform sampler2D depthBuffer;\n${buildAtmosphereEffectFragment()}`
    const farColor = draw(
      `${slotShader}\nvoid main(){vec3 c=vec3(.3,.4,.5);applySlot0(vec3(0.,0.,-1.),1e30,c);gl_FragColor=vec4(c,1.);}`,
      compositionUniforms
    )
    const intermediate = farColor.slice(0, 3).map((value, i) => value * 0.6 + [0.1, 0.2, 0.3][i])
    const ordered = draw(
      `${slotShader}\nvoid main(){vec3 c=vec3(${intermediate.join(',')});applySlot1(vec3(0.,0.,-1.),1e30,c);gl_FragColor=vec4(c,1.);}`,
      compositionUniforms
    )
    const composed = draw(
      `${slotShader}\nvoid main(){vec4 c;mainImage(vec4(.3,.4,.5,1.),vec2(.5),c);gl_FragColor=c;}`,
      compositionUniforms
    )
    close(composed, ordered, 'overlay is processed by foreground slots')
    atmosphere.setCloudOverlay(null)
    atmosphere.update(renderer, input)
    const noOverlay = draw(
      `${slotShader}\nvoid main(){vec4 c;mainImage(vec4(.3,.4,.5,1.),vec2(.5),c);gl_FragColor=c;}`,
      { ...Object.fromEntries(atmosphere.uniforms), depthBuffer: new Uniform(depth) }
    )
    const incorrectlyLast = noOverlay.slice(0, 3).map((value, i) => value * 0.6 + [0.1, 0.2, 0.3][i])
    check(
      !within(incorrectlyLast, ordered.slice(0, 3)),
      'overlay-after-all negative control fails same foreground comparison'
    )
    registry.unregister(3)
    report.cases.push('foreground-slot-order')

    // Untouched production march, real shadows and temporal resolve. Only change light normalization for invariance.
    entry.config.bottomRadius = 6371
    entry.lut = generator.generate(entry.config)
    registry.markReady(entry.actorId)
    depthValues[0] = 1
    depth.needsUpdate = true
    let noon = 0
    for (const [label, sun] of [
      ['noon', new Vector3(0, 0, 1)],
      ['terminator', new Vector3(1, 0, 0)],
      ['night', new Vector3(0, 0, -1)]
    ] as const) {
      const f = frame(origin, endpoint, sun)
      const effect = recreate(f)
      const fresh = render(f)
      const freshCurrent = sample(effect.cloudsPass.resolveMaterial.uniforms.colorBuffer.value!)
      const freshDepth = sample(effect.cloudsPass.resolveMaterial.uniforms.depthVelocityBuffer.value!)
      const freshShadow = sample(effect.atmosphereShadow!.map, true)
      const resolved = render(f)
      const resolvedCurrent = sample(effect.cloudsPass.resolveMaterial.uniforms.colorBuffer.value!)
      const resolvedDepth = sample(effect.cloudsPass.resolveMaterial.uniforms.depthVelocityBuffer.value!)
      const resolvedShadow = sample(effect.atmosphereShadow!.map, true)
      check(fresh.every(Number.isFinite) && resolved.every(Number.isFinite), `${label} finite marched HDR`)
      check(fresh[3] > 0.01 && fresh[3] <= 1, `${label} nonempty actual march`)
      if (label === 'noon') noon = fresh[0] + fresh[1] + fresh[2]
      if (label === 'night') check(fresh[0] + fresh[1] + fresh[2] < noon, 'night has no added daylight floor')
      const control = recreate(f)
      control.cloudsPass.currentMaterial.fragmentShader = control.cloudsPass.currentMaterial.fragmentShader.replace(
        NORMALIZATION,
        ''
      )
      control.cloudsPass.currentMaterial.needsUpdate = true
      for (const [i, expected, expectedDepth, expectedShadow, expectedCurrent] of [
        [0, fresh, freshDepth, freshShadow, freshCurrent],
        [1, resolved, resolvedDepth, resolvedShadow, resolvedCurrent]
      ] as const) {
        const unscaled = render(f)
        unchanged(
          [sample(control.cloudsPass.resolveMaterial.uniforms.colorBuffer.value!)[3]],
          [expectedCurrent[3]],
          `${label}/${i} light-only current march alpha invariant`
        )
        unchanged([unscaled[3]], [expected[3]], `${label}/${i} light-only alpha invariant`)
        unchanged(
          sample(control.cloudsPass.resolveMaterial.uniforms.depthVelocityBuffer.value!),
          expectedDepth,
          `${label}/${i} light-only depth invariant`
        )
        unchanged(
          sample(control.atmosphereShadow!.map, true),
          expectedShadow,
          `${label}/${i} light-only optical shadow invariant`
        )
      }
      report.cases.push(label)
    }
    report.cases.push('alpha-depth-shadow-invariance')

    for (const sun of [new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 0, -1)]) {
      const f = frame(origin, endpoint, sun)
      f.sceneLight = farReceiver.getLightSettings!()
      const calibrated = recreate(f)
      const actual = render(f)
      const actualDepth = sample(calibrated.cloudsPass.resolveMaterial.uniforms.depthVelocityBuffer.value!)
      const actualShadow = sample(calibrated.atmosphereShadow!.map, true)
      const legacyFrame = { ...f, sceneLight: undefined }
      const legacy = recreate(legacyFrame)
      const reference = render(legacyFrame)
      unchanged([actual[3]], [reference[3]], 'scene-reference source preserves fresh actual march alpha')
      unchanged(
        actualDepth,
        sample(legacy.cloudsPass.resolveMaterial.uniforms.depthVelocityBuffer.value!),
        'scene-reference source preserves actual front depth'
      )
      unchanged(
        actualShadow,
        sample(legacy.atmosphereShadow!.map, true),
        'scene-reference source preserves actual optical shadows'
      )
    }
    report.cases.push('scene-reference-march-invariants')

    // Isolate only the actual march's direct source: skylight/ground and aerial exposure are separate terms.
    const directFrame = frame(origin, endpoint)
    entry.config.exposure = 0
    const direct = recreate(directFrame)
    direct.skyLightScale = 0
    direct.groundBounceScale = 0
    const sunlit = render(directFrame)
    check(sunlit[0] + sunlit[1] + sunlit[2] > 1e-5, 'real direct source is nonzero before eclipse')
    const calibratedDirectFrame = { ...directFrame, sceneLight: farReceiver.getLightSettings!() }
    const calibratedDirect = recreate(calibratedDirectFrame)
    calibratedDirect.skyLightScale = 0
    const calibratedSunlit = render(calibratedDirectFrame)
    check(
      calibratedSunlit[0] + calibratedSunlit[1] + calibratedSunlit[2] > 1e-5,
      'calibrated actual direct source exists before eclipse'
    )
    entry.eclipse = {
      count: 1,
      star: new Vector3(0, 0, 149597870),
      starRadius: 696000,
      occluders: [new Vector4(0, 0, 6471, 50), new Vector4(), new Vector4(), new Vector4()],
      umbra: [new Vector4(), new Vector4(), new Vector4(), new Vector4()]
    }
    const eclipsedEffect = recreate(directFrame)
    eclipsedEffect.skyLightScale = 0
    eclipsedEffect.groundBounceScale = 0
    const eclipsed = render(directFrame)
    close(eclipsed.slice(0, 3), [0, 0, 0], 'real march total eclipse direct irradiance', 1e-5)
    close([eclipsed[3]], [sunlit[3]], 'eclipse preserves weather opacity', 1e-6)
    const calibratedEclipsedEffect = recreate(calibratedDirectFrame)
    calibratedEclipsedEffect.skyLightScale = 0
    const calibratedEclipsed = render(calibratedDirectFrame)
    close(
      calibratedEclipsed.slice(0, 3),
      [0, 0, 0],
      'calibrated real march eclipse is not cancelled by phase reference',
      1e-5
    )
    close([calibratedEclipsed[3]], [calibratedSunlit[3]], 'calibrated eclipse preserves weather opacity', 1e-6)
    delete entry.eclipse
    entry.config.exposure = 1.4
    report.cases.push('eclipse-direct')
    report.cases.push('scene-reference-real-eclipse')

    // Public history reset recreates the instance and rebinds all borrowed data.
    const resetFrame = frame(origin, endpoint)
    const beforeReset = recreate(resetFrame)
    render(resetFrame)
    check(
      beforeReset.cloudsPass.currentMaterial.uniforms.sceneCloudLogFarFactor.value === Math.log2(camera.far + 1),
      'depth adapter receives original scene far'
    )
    const generationBefore = lastHistoryGeneration
    backend!.resetHistory()
    const afterReset = activeEffect()
    check(afterReset !== beforeReset, 'history reset recreated public effect')
    afterReset.shadowMaps.mapSize.set(32, 32)
    let publicUpdates = 0
    const update = afterReset.update.bind(afterReset)
    afterReset.update = (...args): void => {
      publicUpdates++
      update(...args)
    }
    check(render(resetFrame).every(Number.isFinite), 'reset produced a fresh finite output')
    check(lastHistoryGeneration === generationBefore + 1, 'history reset increments output generation')
    check(publicUpdates === 1, 'one public update per backend render')
    prepared.config.layers[0].castsShadow = false
    render(resetFrame)
    prepared.config.layers[0].castsShadow = true
    report.cases.push('casts-shadow-false-output')
    const invalid = { ...resetFrame, camera: resetFrame.camera.clone() }
    invalid.camera.near = 1e-8 / UNIT
    invalid.camera.far = 1e9 / UNIT
    invalid.camera.updateProjectionMatrix()
    let invalidProjection = false
    try {
      render(invalid)
    } catch (error) {
      invalidProjection = /projection/.test(String(error))
    }
    check(invalidProjection && publicUpdates === 2, 'nonfinite far-frustum rejected before public update/output')
    check(prepared.config.layers[0].baseAltitudeMeters === 4000, 'datum copy did not mutate prepared source config')
    check(borrowedDisposals === 0, 'effect recreation did not dispose borrowed preparation or LUTs')
    const failedCheck = renderer.debug.checkShaderErrors
    afterReset.cloudsPass.currentMaterial.fragmentShader =
      '#error scene_cloud_fixture_compile\n' + afterReset.cloudsPass.currentMaterial.fragmentShader
    afterReset.cloudsPass.currentMaterial.needsUpdate = true
    let failed = false
    const shaderFailureStart = Date.now()
    try {
      render(resetFrame)
    } catch (error) {
      failed = /shader|scene_cloud_fixture_compile/i.test(String(error))
    }
    report.expectedShaderFailureWindows = [{ start: shaderFailureStart, end: Date.now() + 1 }]
    for (let i = 0; i < 16; i++) {
      const code = renderer.getContext().getError()
      if (code === 0) break
      check(code === renderer.getContext().INVALID_OPERATION, 'intentional failed shader draw GL error')
    }
    check(failed, 'shader compile failure is not published as success')
    check(
      renderer.debug.onShaderError === originalHandler && renderer.debug.checkShaderErrors === failedCheck,
      'shader failure restored renderer error handler'
    )
    backend!.dispose()
    check(borrowedDisposals === 0, 'backend disposal preserves borrowed LUTs and prepared data')
    borrowed.forEach((texture) => texture.removeEventListener('dispose', borrowedDisposed))
    report.cases.push(
      'reset-recreation',
      'single-public-update',
      'shader-failure-restoration',
      'borrowed-ownership',
      'unsupported-projection'
    )
    check(renderer.getContext().getError() === 0, 'no WebGL errors')
  } finally {
    ;(backend as SceneCloudBackend | null)?.dispose()
    for (const resource of owned.reverse()) resource.dispose()
    generator.dispose()
    renderer.setRenderTarget(null)
    report.resourcesReleased =
      renderer.info.memory.textures === 0 && renderer.info.memory.geometries === sharedGeometryBaseline
    Object.assign(report, { memoryAfter: { ...renderer.info.memory }, sharedGeometryBaseline })
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return report
}
