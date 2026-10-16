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
      const freshDepth = sample(effect.cloudsPass.resolveMaterial.uniforms.depthVelocityBuffer.value!)
      const freshShadow = sample(effect.atmosphereShadow!.map, true)
      const resolved = render(f)
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
      for (const [i, expected, expectedDepth, expectedShadow] of [
        [0, fresh, freshDepth, freshShadow],
        [1, resolved, resolvedDepth, resolvedShadow]
      ] as const) {
        const unscaled = render(f)
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

    // Isolate only the actual march's direct source: skylight/ground and aerial exposure are separate terms.
    const directFrame = frame(origin, endpoint)
    entry.config.exposure = 0
    const direct = recreate(directFrame)
    direct.skyLightScale = 0
    direct.groundBounceScale = 0
    const sunlit = render(directFrame)
    check(sunlit[0] + sunlit[1] + sunlit[2] > 1e-5, 'real direct source is nonzero before eclipse')
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
    delete entry.eclipse
    entry.config.exposure = 1.4
    report.cases.push('eclipse-direct')

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
    check(invalidProjection && publicUpdates === 1, 'nonfinite far-frustum rejected before public update/output')
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
