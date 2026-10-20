import {
  BufferAttribute, Camera, Color, DataTexture, FloatType, LinearFilter, Mesh, NoBlending, NormalBlending,
  NoToneMapping, Object3D, PerspectiveCamera, PlaneGeometry, RepeatWrapping, RGBAFormat,
  Scene, ShaderChunk, ShaderMaterial, TextureLoader, Uniform, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { WaterShader } from '@/core/materials/shaders/WaterShader'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { type Actor } from '@/core/models/Actor'
import { SpaceScale } from '@/core/constants'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { SunTintBinding } from '@/core/materials/SunTintBinding'
import { WaterSkyBinding } from '@/core/renderables/Water/WaterSkyBinding'
import { waterSkyFunctions } from '@/core/materials/shaders/lib/chunks/WaterSky'
import { sunTransmittanceUniforms } from '@/core/materials/shaders/lib/chunks/SunTransmittance'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { type AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { RenderingObjects } from '@storage/database'
import { checkOceanRegressions } from './oceanRegressions.gpu'

const metersPerUnit = 1000 / SpaceScale
const radius = 6360000
const width = 320, height = 200
type BaselineShader = { vertexShader: string; fragmentShader: string }
type Capture = { name: string; png: string }

function patch(size: number): PlaneGeometry {
  const geometry = new PlaneGeometry(size / metersPerUnit, size / metersPerUnit, 96, 96)
  geometry.rotateX(-Math.PI / 2)
  const positions = geometry.getAttribute('position')
  const centers = new Float32Array(positions.count * 3)
  const origins = new Float32Array(positions.count * 3)
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) * metersPerUnit, z = positions.getZ(i) * metersPerUnit
    positions.setY(i, (Math.sqrt(radius * radius - x * x - z * z) - radius) / metersPerUnit)
    centers[i * 3 + 1] = radius / metersPerUnit
    origins[i * 3] = 137.25 / metersPerUnit
    origins[i * 3 + 1] = (radius % 40960) / metersPerUnit
    origins[i * 3 + 2] = 936.125 / metersPerUnit
  }
  geometry.setAttribute('patchCenter', new BufferAttribute(centers, 3))
  geometry.setAttribute('detailOrigin', new BufferAttribute(origins, 3))
  return geometry
}

function average(pixels: Float32Array): number {
  let sum = 0
  for (let i = 0; i < pixels.length; i += 4) sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
  return sum / (pixels.length / 4)
}

function difference(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** Actual production shaders, actual water texture and freshly generated Earth LUTs. */
export async function checkOceanView(options: { baseline?: BaselineShader; capture?: boolean } = {}): Promise<unknown> {
  const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
  renderer.setSize(width, height)
  renderer.toneMapping = NoToneMapping
  const gl = renderer.getContext() as WebGL2RenderingContext
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  const device = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) as string
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float readback required')
  const errors: string[] = []
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    errors.push(context.getProgramInfoLog(program) ?? '', context.getShaderInfoLog(vertex) ?? '', context.getShaderInfoLog(fragment) ?? '')
  }
  const check = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(message)
  }
  const generator = new AtmosphereLUTGenerator(renderer)
  const texture = await new TextureLoader().loadAsync('/storage/images/textures/water/waternormals.jpg')
  texture.wrapS = texture.wrapT = RepeatWrapping
  const depthTexel = new Uint8Array([0, 0, 0, 80])
  const depth = new DataTexture(depthTexel, 1, 1, RGBAFormat)
  depth.needsUpdate = true
  const clouds = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat)
  clouds.needsUpdate = true
  const actor = {
    renderingObject: { getAttribute: () => RenderingObjects.find(row => row.actorId === 7)!.data },
    physicalObject: { getAttribute: () => radius / 1000 },
    resources: { where: () => ({ first: () => undefined }) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) }
  } as unknown as Actor
  const shader = new WaterShader(actor)
  const material = new ShaderMaterial({
    uniforms: shader.uniforms, vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader,
    defines: { USE_WATER_WAVES: '1', USE_WATER_DEPTH: '1' }, blending: NoBlending, depthTest: true
  })
  const uniforms = material.uniforms
  uniforms.uWaterNormalMap.value = texture
  uniforms.uSlopeMap.value = depth
  uniforms.uWaterPixelAngle.value = 2 * Math.tan(Math.PI / 6) / height
  uniforms.uTime.value = 7.3
  uniforms.uFoamStrength.value = 1
  const config = structuredClone(RenderingObjects.find(row => row.actorId === 47)!.data) as unknown as AtmosphereConfig
  // Align the test sea level with the atmosphere's own datum.
  config.bottomRadius = radius / 1000
  const lut = generator.generate(config)
  const registry = new AtmosphereRegistry()
  registry.register({ actorId: 47, name: 'Earth', object: new Object3D(), config, lut })
  new SunTintBinding(material, registry, 47, radius / 1000).sync()
  new WaterSkyBinding(material, registry, 47, radius / 1000).sync()
  const fullDefines = { ...material.defines }
  const scene = new Scene()
  const camera = new PerspectiveCamera(60, width / height, 0.05 / metersPerUnit, 10000000 / metersPerUnit)
  const nearGeometry = patch(40000)
  const farGeometry = patch(6000000)
  const mesh = new Mesh(nearGeometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  const target = new WebGLRenderTarget(width, height, { type: FloatType, minFilter: LinearFilter, magFilter: LinearFilter })
  const captures: Capture[] = []
  const sun = new Vector3(0.25, 0.45, -1).normalize()
  const setSun = (direction: Vector3): void => {
    sun.copy(direction).normalize()
    uniforms.lightPosition.value.copy(sun).multiplyScalar(10000)
  }
  setSun(sun)
  const setView = (altitude: number, lookDistance: number): void => {
    camera.position.set(0, altitude / metersPerUnit, 0)
    camera.lookAt(0, 0, -lookDistance / metersPerUnit)
    camera.updateMatrixWorld()
  }
  setView(12, 100)

  // Display-only background uses the same sky LUT; numerical probes have a black background.
  const skyScene = new Scene()
  const skyMaterial = new ShaderMaterial({
    uniforms: {
      ...uniforms, uProbeSun: new Uniform(sun),
      uProbeCameraRotation: new Uniform(camera.matrixWorld),
      uProbeAspect: new Uniform(width / height)
    },
    defines: { USE_SUN_TINT: '1', USE_WATER_SKY: '1' }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: /* glsl */ `
      ${ShaderChunk.common}
      ${sunTransmittanceUniforms}
      ${waterSkyFunctions}
      uniform vec3 uProbeSun;
      uniform mat4 uProbeCameraRotation;
      uniform float uProbeAspect;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv * 2.0 - 1.0) * tan(0.5235987756);
        vec3 ray = mat3(uProbeCameraRotation) * normalize(vec3(p.x * uProbeAspect, p.y, -1.0));
        gl_FragColor = vec4(waterSkyRadiance(vec3(0, 1, 0), ray, uProbeSun, vec3(1.0)), 1.0);
        ${ShaderChunk.colorspace_fragment}
      }
    `
  })
  const skyQuad = new Mesh(new PlaneGeometry(2, 2), skyMaterial)
  skyScene.add(skyQuad)
  const read = (): Float32Array => {
    renderer.setRenderTarget(target)
    renderer.setClearColor(0, 0)
    renderer.render(scene, camera)
    const pixels = new Float32Array(width * height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
    check(errors.length === 0 && gl.getError() === 0, `Shader/WebGL errors: ${errors.join('\n')}`)
    check(pixels.every(Number.isFinite), 'Non-finite water pixels')
    check(pixels.every(v => v >= -1e-5), 'Negative water output')
    return pixels
  }
  const capture = (name: string): void => {
    if (!options.capture) return
    renderer.setSize(960, 600)
    uniforms.uWaterPixelAngle.value = 2 * Math.tan(Math.PI / 6) / 600
    renderer.setRenderTarget(null)
    renderer.autoClear = true
    renderer.render(skyScene, new Camera())
    renderer.autoClear = false
    renderer.render(scene, camera)
    renderer.autoClear = true
    captures.push({ name, png: renderer.domElement.toDataURL('image/png') })
    renderer.setSize(width, height)
    uniforms.uWaterPixelAngle.value = 2 * Math.tan(Math.PI / 6) / height
  }
  const setBaseline = (enabled: boolean): void => {
    material.vertexShader = enabled ? AbstractShader.prepareSource(options.baseline!.vertexShader) : shader.vertexShader
    material.fragmentShader = enabled ? AbstractShader.prepareSource(options.baseline!.fragmentShader) : shader.fragmentShader
    material.needsUpdate = true
  }
  try {
    const near = read()
    check(average(near) > 0.001, 'Empty water render')
    // Crests move into and out of this small field of view. Exercise a time
    // interval so the control check does not require foam in every single frame.
    const sceneTime = uniforms.uTime.value
    const foamColor = uniforms.uFoamColor.value.clone()
    let foamDifference = 0
    for (const time of [0, 3, 6, 9, 12]) {
      uniforms.uTime.value = time
      uniforms.uFoamStrength.value = 1
      const withFoam = read()
      uniforms.uFoamStrength.value = 0
      const withoutFoam = read()
      foamDifference = Math.max(foamDifference, difference(withFoam, withoutFoam))
      uniforms.uFoamColor.value.setRGB(1, 0, 0)
      check(difference(withoutFoam, read()) < 1e-7, 'Foam still present at zero strength')
      uniforms.uFoamColor.value.copy(foamColor)
    }
    check(foamDifference > 1e-6, `Foam strength does not control crest foam: ${foamDifference}`)
    uniforms.uTime.value = sceneTime
    uniforms.uFoamStrength.value = 1
    capture('after-day')
    if (options.baseline) {
      setBaseline(true)
      read()
      capture('before-day')
      setBaseline(false)
    }
    uniforms.uTime.value += 1
    const animationDifference = difference(near, read())
    check(animationDifference > 0.0001, `Wave animation disappeared: ${animationDifference}`)
    uniforms.uTime.value -= 1
    const origins = nearGeometry.getAttribute('detailOrigin') as BufferAttribute
    const originalOrigins = new Float32Array(origins.array)
    let wrapDifference = 0
    for (let axis = 0; axis < 3; axis++) {
      for (let i = 0; i < origins.count; i++) origins.array[i * 3 + axis] += 40960 / metersPerUnit
      origins.needsUpdate = true
      wrapDifference = Math.max(wrapDifference, difference(near, read()))
      origins.array.set(originalOrigins)
      origins.needsUpdate = true
    }
    check(wrapDifference < 0.001, `RTC wrap seam: ${wrapDifference}`)

    setView(2, 150)
    const grazing = read()
    check(average(grazing) > 0.001, 'Empty grazing water')
    capture('after-grazing')
    setView(12, 100)
    setSun(new Vector3(0.05, 0.015, -1))
    const dusk = read()
    capture('after-dusk')
    setSun(new Vector3(0.2, -0.8, -1))
    const night = read()
    check(average(night) < average(near), 'Night water brighter than day')
    uniforms.uWaterGlintGain.value = 0
    check(difference(night, read()) < 1e-7, 'Below-horizon sun produces a highlight')
    uniforms.uWaterGlintGain.value = 1
    capture('after-night')
    setSun(new Vector3(0.25, 0.45, -1))

    // Real combinations of streaming gates, including atmosphere absence.
    const variants: string[] = []
    for (const gates of [
      {}, { USE_WATER_DEPTH: '1' }, { USE_WATER_WAVES: '1' },
      { USE_WATER_WAVES: '1', USE_WATER_DEPTH: '1', USE_WATER_CLOUD: '1' },
      { ...fullDefines, USE_WATER_CLOUD: '1' }, fullDefines
    ]) {
      material.defines = gates
      material.needsUpdate = true
      uniforms.uWaterCloudMap.value = clouds
      read()
      variants.push(Object.keys(gates).join('+') || 'bare')
    }
    // Shallows retain a dielectric reflection without becoming opaque.
    depthTexel[3] = 0
    depth.needsUpdate = true
    const shallow = read()
    const bottomCenterAlpha = shallow[(width / 2) * 4 + 3]
    check(bottomCenterAlpha >= 0.019 && bottomCenterAlpha < 0.99, `Invalid shallow coverage: ${bottomCenterAlpha}`)
    // Exercise the same transparent blending/depth flags as WaterMaterial over
    // a known linear ground colour, not only the isolated shader's RGBA.
    const ground = new Color(0.08, 0.12, 0.05)
    scene.background = ground
    material.transparent = true
    material.blending = NormalBlending
    material.depthWrite = false
    material.needsUpdate = true
    const composited = read()
    let compositionError = 0
    const groundChannels = ground.toArray()
    for (let i = 0; i < shallow.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const expected = shallow[i + c] * shallow[i + 3] + groundChannels[c] * (1 - shallow[i + 3])
        compositionError = Math.max(compositionError, Math.abs(composited[i + c] - expected))
      }
    }
    check(compositionError < 2e-5, `Water/ground alpha composition changed: ${compositionError}`)
    scene.background = null
    material.transparent = false
    material.blending = NoBlending
    material.depthWrite = true
    material.needsUpdate = true
    depthTexel[3] = 80
    depth.needsUpdate = true
    mesh.geometry = farGeometry
    setView(2000000, 0.001)
    const orbit = read()
    let orbitalDifference: number | null = null
    if (options.baseline) {
      setBaseline(true)
      orbitalDifference = difference(orbit, read())
      check(orbitalDifference < 1e-6, `Distant water changed: ${orbitalDifference}`)
      setBaseline(false)
    }
    mesh.geometry = nearGeometry
    setView(12, 100)
    const regressions = checkOceanRegressions({ material, camera, height, read, setView })
    // Matched before/after timing at the screenshot resolution, separate from
    // the smaller numerical readbacks. This measures water only, not scene FPS.
    target.setSize(960, 600)
    uniforms.uWaterPixelAngle.value = 2 * Math.tan(Math.PI / 6) / 600
    renderer.setRenderTarget(target)
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    const measure = async (): Promise<number | null> => {
      for (let i = 0; i < 12; i++) renderer.render(scene, camera)
      if (!timer) return null
      const query = gl.createQuery()!
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query)
      for (let i = 0; i < 30; i++) renderer.render(scene, camera)
      gl.endQuery(timer.TIME_ELAPSED_EXT)
      gl.flush()
      let milliseconds: number | null = null
      for (let attempts = 0; attempts < 100; attempts++) {
        await new Promise(resolve => setTimeout(resolve, 20))
        if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) milliseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 / 30
          break
        }
      }
      gl.deleteQuery(query)
      return milliseconds
    }
    const afterMs = await measure()
    let beforeMs: number | null = null
    if (options.baseline) {
      setBaseline(true)
      beforeMs = await measure()
      setBaseline(false)
    }
    check(errors.length === 0, errors.join('\n'))
    return {
      device, resolution: [width, height], animationDifference, foamDifference, wrapDifference, orbitalDifference, compositionError,
      timing: { resolution: [960, 600], beforeMs, afterMs }, variants, regressions,
      luminance: { day: average(near), grazing: average(grazing), dusk: average(dusk), night: average(night) },
      captures
    }
  } finally {
    material.dispose()
    skyMaterial.dispose()
    skyQuad.geometry.dispose()
    nearGeometry.dispose()
    farGeometry.dispose()
    target.dispose()
    texture.dispose()
    depth.dispose()
    clouds.dispose()
    generator.dispose()
    renderer.dispose()
  }
}
