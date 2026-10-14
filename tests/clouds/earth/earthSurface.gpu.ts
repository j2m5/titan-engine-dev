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
  type ShaderMaterial,
  type Texture
} from 'three'
import type { AtmosphereShadow } from '@takram/three-atmosphere'
import { PlanetAerialPerspectiveEffect } from '@/labs/jupiter-clouds/planetDepth'
import { createEarthSurfaceMaterials, type EarthSurfaceOptions } from '@/labs/earth-clouds/EarthSurfaceMaterial'
import type { EarthGpuProbeReport } from './gpuTestHarness'

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
