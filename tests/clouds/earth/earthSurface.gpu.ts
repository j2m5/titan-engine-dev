import {
  DataTexture,
  Data3DTexture,
  DataArrayTexture,
  FloatType,
  HalfFloatType,
  RGBAFormat,
  NearestFilter,
  Vector2,
  Vector3,
  Matrix4,
  PerspectiveCamera,
  PlaneGeometry,
  Mesh,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
  DataUtils,
  Quaternion,
  Vector4,
  Matrix3,
  type ShaderMaterial,
  type Texture
} from 'three'
import type { AtmosphereShadow } from '@takram/three-atmosphere'
import { PlanetAerialPerspectiveEffect } from '@/labs/jupiter-clouds/planetDepth'
import { createEarthSurfaceMaterials, type EarthSurfaceOptions } from '@/labs/earth-clouds/EarthSurfaceMaterial'
import type { EarthGpuProbeReport } from './gpuTestHarness'
import { createGpuReadback, extractShaderFunction } from './gpuTestHarness'
import { createEarthClouds, createEarthAtmosphere } from '@/labs/earth-clouds/EarthCloudAdapter'
import { createEarthCloudProfile } from '@/labs/earth-clouds/earthCloudProfile'
import { bindCloudAppearance } from '@/labs/jupiter-clouds/cloudAppearance'
import { prepareRgbCloudTextures } from '@/labs/earth-clouds/earthCloudTextures'

export async function checkEarthSurface(): Promise<EarthGpuProbeReport> {
  const renderer = new WebGLRenderer(),
    owned: Texture[] = []
  renderer.debug.onShaderError = (gl, p, v, f) => {
    throw new Error(
      `Surface shader compile: ${gl.getProgramInfoLog(p)} ${gl.getShaderInfoLog(v)} ${gl.getShaderInfoLog(f)}`
    )
  }
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
  const geometry = new PlaneGeometry(100, 100)
  geometry.translate(0, 0, 6360000)
  const camera = new PerspectiveCamera(50, 1, 1, 100000),
    aerial = new PlanetAerialPerspectiveEffect(camera)
  const make = (bytes: number[]) => {
    const t = new DataTexture(new Uint8Array(bytes), 1, 1, RGBAFormat)
    t.minFilter = t.magFilter = NearestFilter
    t.needsUpdate = true
    owned.push(t)
    return t
  }
  const surface = make([64, 32, 16, 255]),
    cloud = make([0, 0, 0, 255]),
    night = make([255, 255, 255, 255]),
    specular = make([255, 255, 255, 255]),
    lut = make([255, 255, 255, 255])
  const noise = new Data3DTexture(new Uint8Array(4), 1, 1, 1)
  noise.needsUpdate = true
  owned.push(noise)
  const options: EarthSurfaceOptions = {
    textures: { surface, clouds: cloud, night, specular, dispose() {} },
    radiusMeters: 6360000,
    atmosphere: {
      bottomRadius: 6360,
      topRadius: 6420,
      sunAngularRadius: 0.004675
    } as EarthSurfaceOptions['atmosphere'],
    lut: { transmittanceTexture: lut, irradianceTexture: lut },
    stbnTexture: noise,
    longitudeOffsetRadians: 0,
    shadowReferenceShader: aerial.getFragmentShader()
  }
  const pair = createEarthSurfaceMaterials(options)
  if (pair.volumeError) throw pair.volumeError
  const scene = new Scene(),
    mesh = new Mesh(geometry, pair.far)
  scene.add(mesh)
  const sources = new Map([
    [pair.far, pair.far.fragmentShader],
    [pair.near, pair.near.fragmentShader]
  ])
  const report: EarthGpuProbeReport = { name: 'earth-surface', checks: 0, maxError: 0, resourcesReleased: false }
  function check(actual: number[], expected: number[], label: string, tolerance = 0.003) {
    const error = Math.max(...expected.map((x, i) => Math.abs(actual[i] - x)))
    if (!Number.isFinite(error) || error > tolerance)
      throw new Error(`${label}: ${JSON.stringify({ actual, expected, error })}`)
    report.checks++
    report.maxError = Math.max(error, report.maxError)
  }
  const sun = new Vector3(0, 0, 1)
  let distance = 1000,
    frame = 0
  function sync() {
    camera.position.set(0, 0, 6360000 + distance).applyMatrix4(mesh.matrix)
    camera.lookAt(new Vector3(0, 0, 6360000).applyMatrix4(mesh.matrix))
    camera.updateMatrixWorld()
    pair.updateFrame({
      camera,
      planetMatrixWorld: mesh.matrix,
      worldToECEFMatrix: new Matrix4(),
      sunDirection: sun,
      resolution: new Vector2(1, 1),
      frame: frame++
    })
  }
  const output = 'gl_FragColor = vec4(min(finalColor, vec3(4.0)), 1.0);'
  function render(material: ShaderMaterial, expression?: string, mutation?: (s: string) => string) {
    sync()
    mesh.material = material
    let source = sources.get(material)!
    if (expression) source = source.replace(output, `gl_FragColor = ${expression};`)
    material.fragmentShader = mutation ? mutation(source) : source
    material.needsUpdate = true
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const data = new Uint16Array(4)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, data)
    const error = renderer.getContext().getError()
    if (error) throw new Error(`Surface GL error ${error}`)
    return Array.from(data, DataUtils.fromHalfFloat)
  }
  const cloudColor = (white: boolean) => {
    ;(cloud.image.data as Uint8Array).set(white ? [255, 255, 255, 255] : [0, 0, 0, 255])
    pair.far.uniforms.earthCloudMap.value.needsUpdate = true
  }
  const shadow = (count: number, tau: number): AtmosphereShadow => {
    const data = new Float32Array(4 * count)
    for (let i = 0; i < count; i++) data.set([0, tau / 8000, tau, 0], 4 * i)
    const map = new DataArrayTexture(data, 1, 1, count)
    map.type = FloatType
    map.minFilter = map.magFilter = NearestFilter
    map.needsUpdate = true
    owned.push(map)
    return {
      map,
      mapSize: new Vector2(1, 1),
      cascadeCount: count,
      intervals: Array.from({ length: count }, (_, i) => new Vector2(i / count, (i + 1) / count)),
      matrices: Array.from({ length: count }, () => new Matrix4().makeScale(0.001, 0.001, 0)),
      inverseMatrices: Array.from({ length: count }, () => new Matrix4()),
      far: 10000,
      topHeight: 8000
    }
  }
  try {
    const geographic = checkGeographicBindings(pair)
    report.checks += geographic.checks
    report.maxError = Math.max(report.maxError, geographic.maxError)
    // Compile and render the complete real materials before instrumenting values.
    const baseline = render(pair.far)
    check(render(pair.near), baseline, 'near ignores black map')
    check(render(pair.far, 'vec4(surfaceAlbedo,1.)'), [64 / 255, 32 / 255, 16 / 255, 1], 'black preserves diffuse')
    check(render(pair.far, 'vec4(specularIntensity)'), [1, 1, 1, 1], 'black preserves glint')
    cloudColor(true)
    check(render(pair.far, 'vec4(surfaceAlbedo,1.)'), [1, 1, 1, 1], 'white replaces diffuse')
    check(render(pair.far, 'vec4(specularIntensity)'), [0, 0, 0, 0], 'white removes glint')
    check(render(pair.near), baseline, 'near ignores white map')
    pair.setMapEnabled(false)
    check(render(pair.far), baseline, 'map toggle')
    pair.setMapEnabled(true)
    sun.set(0, 0, -1)
    cloudColor(false)
    const nightValue = render(pair.far, 'vec4(night,1.)')
    check(nightValue, [1, 0.97, 0.92, 1], 'black preserves night')
    cloudColor(true)
    check(render(pair.far, 'vec4(night,1.)'), [0, 0, 0, 1], 'white removes night')
    check(render(pair.near, 'vec4(night,1.)'), nightValue, 'near night ignores clouds')
    sun.set(0, 0, 1)
    check(render(pair.far, 'vec4(uv,0.,1.)'), [0.25, 0.5, 0, 1], 'canonical projection')
    pair.far.uniforms.earthLongitudeOffset.value = Math.PI
    check(render(pair.far, 'vec4(uv,0.,1.)'), [0.75, 0.5, 0, 1], 'longitude applied once')
    mesh.rotation.y = Math.PI / 2
    mesh.updateMatrix()
    // Geometry remains planet-local: project from the local position even with a rotated matrix.
    check(render(pair.far, 'vec4(uv,0.,1.)'), [0.75, 0.5, 0, 1], 'rotation preserves local projection')
    mesh.rotation.y = 0
    mesh.updateMatrix()
    const marker = new DataTexture(
      new Uint8Array([0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255]),
      4,
      1,
      RGBAFormat
    )
    marker.minFilter = marker.magFilter = NearestFilter
    marker.needsUpdate = true
    owned.push(marker)
    const original = pair.far.uniforms.diffuseMap.value
    pair.far.uniforms.diffuseMap.value = marker
    pair.setMapEnabled(false)
    pair.far.uniforms.earthLongitudeOffset.value = 0
    check(render(pair.far, 'vec4(surfaceAlbedo,1.)'), [1, 0, 0, 1], 'texture longitude red marker')
    pair.far.uniforms.earthLongitudeOffset.value = Math.PI
    check(render(pair.far, 'vec4(surfaceAlbedo,1.)'), [0, 1, 0, 1], 'texture longitude green marker')
    mesh.rotation.y = Math.PI / 2
    mesh.updateMatrix()
    check(render(pair.far, 'vec4(surfaceAlbedo,1.)'), [0, 1, 0, 1], 'rotated texture marker stays fixed')
    mesh.rotation.y = 0
    mesh.updateMatrix()
    pair.far.uniforms.diffuseMap.value = original
    const descriptor = shadow(2, 1)
    pair.bindShadow(descriptor)
    check(
      render(pair.near, 'vec4(earthShadowGetDistanceToShadowTop(vec3(0.,0.,6360.))/8000.)'),
      [1, 1, 1, 1],
      '8000 metre shadow top',
      0.002
    )
    check(render(pair.near, 'vec4(directGain)'), [0.367879, 0.367879, 0.367879, 0.367879], 'exp(-1) direct')
    check(render(pair.near, 'vec4(specularIntensity)'), [0.367879, 0.367879, 0.367879, 0.367879], 'exp(-1) glint')
    const ambient = render(pair.near, 'vec4(ambient,1.)')
    pair.bindShadow(null)
    check(render(pair.near, 'vec4(ambient,1.)'), ambient, 'ambient unaffected')
    sun.set(0, 0, -1)
    const unshadowedNight = render(pair.near, 'vec4(night,1.)')
    pair.bindShadow(descriptor)
    check(render(pair.near, 'vec4(night,1.)'), unshadowedNight, 'night unaffected')
    sun.set(0, 0, 1)
    distance = 8000
    check(render(pair.near, 'vec4(directGain)'), [0.367879, 0.367879, 0.367879, 0.367879], 'fade begins at 0.8far')
    distance = 9000
    check(render(pair.near, 'vec4(directGain)'), [0.606531, 0.606531, 0.606531, 0.606531], 'continuous mid fade')
    distance = 10000
    check(render(pair.near, 'vec4(directGain)'), [1, 1, 1, 1], 'fade reaches far')
    distance = 11000
    check(render(pair.near, 'vec4(directGain)'), [1, 1, 1, 1], 'outside far')
    distance = 1000
    const next = shadow(3, 0.5)
    descriptor.cascadeCount = 3
    descriptor.intervals = next.intervals
    descriptor.matrices = next.matrices
    descriptor.inverseMatrices = next.inverseMatrices
    descriptor.map = next.map
    check(
      render(pair.near, 'vec4(directGain)'),
      [0.606531, 0.606531, 0.606531, 0.606531],
      'same descriptor cascade 2 to 3 and ping-pong A to B'
    )
    descriptor.map = shadow(3, 1).map
    check(render(pair.near, 'vec4(directGain)'), [0.367879, 0.367879, 0.367879, 0.367879], 'ping-pong B to A')
    // Deliberate mutations must produce different actual GPU output.
    const mutationFails = (
      material: ShaderMaterial,
      expression: string,
      mutate: (s: string) => string,
      expected: number[],
      label: string
    ) => {
      const actual = render(material, expression, mutate)
      if (Math.max(...expected.map((v, i) => Math.abs(actual[i] - v))) < 0.02)
        throw new Error(`Mutation escaped: ${label}`)
      report.checks++
    }
    pair.setMapEnabled(false)
    mutationFails(
      pair.far,
      'vec4(surfaceAlbedo,1.)',
      (s) => s.replace('earthSurfaceMapEnabled ? earthCloud.coverage : 0.0', 'earthCloud.coverage'),
      [64 / 255, 32 / 255, 16 / 255, 1],
      'map gating'
    )
    mutationFails(
      pair.near,
      'vec4(directGain)',
      (s) => s.replace('* cloudShadow * earthSunTransmittance', '* cloudShadow'),
      [0.367879, 0.367879, 0.367879, 0.367879],
      'shadow binding'
    )
  } finally {
    pair.dispose()
    owned.forEach((t) => t.dispose())
    aerial.dispose()
    geometry.dispose()
    target.dispose()
    renderer.setRenderTarget(null)
    report.resourcesReleased = renderer.info.memory.textures === 0 && renderer.info.memory.geometries === 0
    renderer.dispose()
    renderer.forceContextLoss()
  }
  if (!report.resourcesReleased) throw new Error('Surface probe resources leaked')
  return report
}

/** Exercise shader functions taken from the actual bound passes with their real uniforms. */
function checkGeographicBindings(pair: ReturnType<typeof createEarthSurfaceMaterials>) {
  const gpu = createGpuReadback()
  const camera = new PerspectiveCamera()
  const clouds = createEarthClouds(camera, createEarthAtmosphere().atmosphere)
  // Every row/column differs, including both sides of the seam and polar rows.
  const bytes = Uint8Array.from(Array.from({ length: 32 }, (_, i) => [32 + i * 6, 32 + i * 6, 32 + i * 6, 255]).flat())
  const source = new DataTexture(bytes, 8, 4, RGBAFormat)
  source.minFilter = source.magFilter = NearestFilter
  source.needsUpdate = true
  const maps = prepareRgbCloudTextures(source)
  maps.weather.minFilter = maps.weather.magFilter = NearestFilter
  const binding = bindCloudAppearance(clouds, createEarthCloudProfile(), maps)
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.63)
  const translation = new Vector3(8e7, -5e7, 3e7)
  const planet = new Matrix4().makeRotationFromQuaternion(rotation)
  const worldToECEF = new Matrix4()
  const farSource = pair.far.fragmentShader
  const canonicalUv = farSource.match(/vec3 earthDirection[^]*?vec2 uv = [^;]+;/)![0]
  const codec = farSource.slice(farSource.indexOf('struct RgbCloudSample'), farSource.indexOf('void main()'))
  const sourceMap = pair.far.uniforms.earthCloudMap.value
  const longitude = pair.far.uniforms.earthLongitudeOffset.value
  pair.far.uniforms.earthCloudMap.value = source
  pair.far.uniforms.earthLongitudeOffset.value = 0
  const shadowData = new Float32Array(32 * 4)
  for (let i = 0; i < 32; i++) {
    const a = Math.sqrt((32 + i * 6) / 255)
    shadowData.set([0, a, a, 0], i * 4)
  }
  const shadowMap = new DataArrayTexture(shadowData, 8, 4, 1)
  shadowMap.type = FloatType
  shadowMap.minFilter = shadowMap.magFilter = NearestFilter
  shadowMap.needsUpdate = true
  const descriptor: AtmosphereShadow = {
    map: shadowMap,
    mapSize: new Vector2(8, 4),
    cascadeCount: 1,
    intervals: [new Vector2(0, 1)],
    matrices: [new Matrix4()],
    inverseMatrices: [new Matrix4()],
    far: 100000,
    topHeight: 8000
  }
  const receiverSource = pair.near.fragmentShader
  const receiverSample = () =>
    gpu.run(
      'vec2 uv=earthShadowGetShadowUv(probeWorld,0);float tau=earthShadowReadShadowOpticalDepth(uv,1.,0);gl_FragColor=vec4(tau,0.,0.,0.);',
      `precision highp sampler2DArray;uniform mat4 earthShadowShadowMatrices[1];uniform sampler2DArray earthShadowShadowBuffer;uniform vec3 probeWorld;${extractShaderFunction(receiverSource, 'earthShadowGetShadowUv')}${extractShaderFunction(receiverSource, 'earthShadowReadShadowOpticalDepth')}`,
      { ...pair.near.uniforms, probeWorld: { value: world } }
    )
  const point = new Vector3(),
    world = new Vector3()
  const report = { checks: 0, maxError: 0 }
  let released = false
  const check = (actual: number[], expected: number[], label: string) => {
    const error = Math.max(...actual.map((value, i) => Math.abs(value - expected[i])))
    if (!Number.isFinite(error) || error > 2 / 255)
      throw new Error(`${label}: ${JSON.stringify({ actual, expected, error })}`)
    report.maxError = Math.max(report.maxError, error)
    report.checks++
  }
  const weatherDeclarations =
    'struct WeatherSample {vec4 heightFraction;vec4 density;};uniform sampler2D localWeatherTexture;uniform vec4 minLayerHeights,maxLayerHeights,shapeAlteringBiases,shadowLayerMask;uniform mat3 cloudECEFToPlanet;uniform float cloudLongitudeOffset;uniform mat4 worldToECEFMatrix;uniform vec3 probeWorld;vec4 remapClamped(vec4 x,vec4 a,vec4 b){return clamp((x-a)/(b-a),0.,1.);}'
  const sample = (pass: typeof clouds.cloudsPass | typeof clouds.shadowPass) => {
    const material = pass.currentMaterial
    const shader = material.fragmentShader
    return gpu.run(
      'vec2 uv=getGlobeUv((worldToECEFMatrix*vec4(probeWorld,1.)).xyz);gl_FragColor=sampleWeather(uv,6000.,0.).density;',
      `${pass === clouds.shadowPass ? '#define SHADOW\n' : ''}${weatherDeclarations}${extractShaderFunction(shader, 'getGlobeUv')}${extractShaderFunction(shader, 'shapeAlteringFunction')}${extractShaderFunction(shader, 'sampleWeather')}`,
      {
        ...material.uniforms,
        probeWorld: { value: world },
        minLayerHeights: { value: new Vector4(4000, 0, 0, 0) },
        maxLayerHeights: { value: new Vector4(8000, 1, 1, 1) },
        shapeAlteringBiases: { value: new Vector4(1, 1, 1, 1) },
        shadowLayerMask: { value: new Vector4(1, 0, 0, 0) }
      }
    )
  }
  try {
    binding.setPlanetRotation(rotation)
    let translationRejects = 0,
      rotationRejects = 0,
      receiverRejects = 0
    for (const [u, v] of [
      [0.001, 0.375],
      [0.999, 0.625],
      [0.1875, 0.999],
      [0.6875, 0.001],
      [0.4375, 0.625]
    ]) {
      const phi = u * Math.PI * 2,
        theta = (1 - v) * Math.PI
      point
        .set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
        .multiplyScalar(6366000)
      world.copy(point).applyMatrix4(planet)
      const baseline = sample(clouds.cloudsPass)
      check(sample(clouds.shadowPass), baseline, 'cloud/shadow geographic marker')
      const far = gpu.run(
        `${canonicalUv}gl_FragColor=vec4(decodeRgbCloud(texture2D(earthCloudMap,uv).rgb).coverage,0.,0.,0.);`,
        `#define PI 3.141592653589793\n#define PI2 6.283185307179586\nuniform vec3 vPosition;uniform float earthLongitudeOffset;uniform sampler2D earthCloudMap;${codec}`,
        { ...pair.far.uniforms, vPosition: { value: point } }
      )
      check(baseline, far, 'far map / bound volume geography')
      const shadowProjection = new Matrix4()
        .makeScale(1e-8, 1e-8, 0)
        .multiply(new Matrix4().makeRotationFromQuaternion(rotation.clone().invert()))
      shadowProjection.elements[12] = 2 * u - 1 - point.x * 1e-8
      shadowProjection.elements[13] = 2 * v - 1 - point.y * 1e-8
      descriptor.matrices[0].copy(shadowProjection)
      pair.bindShadow(descriptor)
      pair.updateFrame({
        camera,
        planetMatrixWorld: planet,
        worldToECEFMatrix: worldToECEF,
        sunDirection: new Vector3(0, 0, 1),
        resolution: new Vector2(1, 1),
        frame: 0
      })
      check(receiverSample(), far, 'actual shadow receiver geographic marker')
      planet.setPosition(translation)
      worldToECEF.makeTranslation(-translation.x, -translation.y, -translation.z)
      clouds.worldToECEFMatrix.copy(worldToECEF)
      camera.position.copy(world).add(translation)
      camera.updateMatrixWorld()
      world.copy(point).applyMatrix4(planet)
      descriptor.matrices[0].copy(shadowProjection).multiply(worldToECEF)
      pair.updateFrame({
        camera,
        planetMatrixWorld: planet,
        worldToECEFMatrix: worldToECEF,
        sunDirection: new Vector3(0, 0, 1),
        resolution: new Vector2(1, 1),
        frame: 0
      })
      check(sample(clouds.cloudsPass), baseline, 'translated volume marker')
      check(sample(clouds.shadowPass), baseline, 'translated shadow marker')
      check(receiverSample(), far, 'translated actual receiver marker')
      // Keep the mutation in force until the failed GPU sample has been asserted.
      const original = worldToECEF.clone()
      try {
        clouds.worldToECEFMatrix.identity()
        const broken = sample(clouds.cloudsPass)
        if (Math.abs(broken[0] - baseline[0]) > 0.02) translationRejects++
      } finally {
        clouds.worldToECEFMatrix.copy(original)
      }
      const matrix = clouds.cloudsPass.currentMaterial.uniforms.cloudECEFToPlanet.value as Matrix3
      const saved = matrix.clone()
      try {
        matrix.identity()
        const broken = sample(clouds.cloudsPass)
        if (Math.abs(broken[0] - baseline[0]) > 0.02) rotationRejects++
      } finally {
        matrix.copy(saved)
      }
      const receiverMatrix = pair.near.uniforms.earthShadowShadowMatrices.value[0] as Matrix4
      const receiverSaved = receiverMatrix.clone()
      try {
        receiverMatrix.copy(shadowProjection)
        if (Math.abs(receiverSample()[0] - far[0]) > 0.02) receiverRejects++
      } finally {
        receiverMatrix.copy(receiverSaved)
      }
      planet.setPosition(0, 0, 0)
      worldToECEF.identity()
      clouds.worldToECEFMatrix.identity()
    }
    if (!translationRejects || !rotationRejects || !receiverRejects)
      throw new Error(
        `Geographic negative controls escaped: ${translationRejects}/${rotationRejects}/${receiverRejects}`
      )
    report.checks += 3
  } finally {
    pair.far.uniforms.earthCloudMap.value = sourceMap
    pair.far.uniforms.earthLongitudeOffset.value = longitude
    pair.bindShadow(null)
    binding.dispose()
    maps.dispose()
    source.dispose()
    shadowMap.dispose()
    clouds.dispose()
    released = gpu.dispose()
  }
  if (!released) throw new Error('Geographic resources leaked')
  return report
}
