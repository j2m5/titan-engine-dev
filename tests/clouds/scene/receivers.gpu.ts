import {
  Color,
  Data3DTexture,
  DataArrayTexture,
  DataTexture,
  FloatType,
  Matrix4,
  Mesh,
  NearestFilter,
  PerspectiveCamera,
  Quaternion,
  RedFormat,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  LinearSRGBColorSpace
} from 'three'
import type { Actor } from '@/core/models/Actor'
import { createRenderer } from '@/core/graphic/renderingFactories'
import { SpaceScale } from '@/core/constants'
import { SphereSurfaceMaterial } from '@/core/materials/SphereSurfaceMaterial'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import type { SceneCloudOutput } from '@/core/clouds/takram/SceneCloudBackend'
import type { SurfaceCloudMap } from '@/core/clouds/SceneCloudConfig'
import type { SceneCloudProbeReport } from './probe'
import { withSceneCloudMaterials } from '@/core/graphic/clouds/sceneCloudMaterialScope'

// Controlled geometry/model/map/shadow fixtures; the three color materials and their receivers are production code.
function actor(): Actor {
  const empty = { first: () => undefined, isNotEmpty: () => false }
  return {
    getAttribute: (_key: string, fallback: unknown) => fallback,
    physicalObject: { getAttribute: () => 6371 },
    renderingObject: { getAttribute: () => ({ emission: 1, bumpScale: 0, terrainLambert: 1 }) },
    children: { where: () => empty },
    resources: { where: () => empty, first: () => undefined }
  } as unknown as Actor
}

export async function run(): Promise<SceneCloudProbeReport> {
  const report: SceneCloudProbeReport = {
    name: 'receivers',
    checks: 0,
    maxError: 0,
    resourcesReleased: false,
    cases: []
  }
  const check = (ok: boolean, label: string) => {
    if (!ok) throw Error(label)
    report.checks++
  }
  const close = (actual: number, expected: number, label: string, tolerance = 0.003) => {
    const error = Math.abs(actual - expected)
    check(Number.isFinite(actual) && error <= tolerance, `${label}: ${actual} != ${expected} (${error})`)
    report.maxError = Math.max(report.maxError, error)
  }
  const renderer = createRenderer({ logarithmicDepthBuffer: true, antialias: false }, 1)
  renderer.setSize(33, 33)
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw Error(
      `receivers shader: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`
    )
  }
  const target = new WebGLRenderTarget(33, 33, { type: FloatType })
  const scene = new Scene(),
    camera = new PerspectiveCamera(40, 1, 1e-6, 1e5)
  const unit = SpaceScale / 1000,
    radius = 6371000
  camera.position.set(0.7 * radius * unit, 0.15 * radius * unit, 1.7 * radius * unit)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  let serial = 0
  const frame = (): CloudFrame => {
    camera.updateMatrixWorld()
    const local = camera.clone(false)
    local.position.copy(camera.position).multiplyScalar(1 / unit)
    local.near /= unit
    local.far /= unit
    local.updateProjectionMatrix()
    local.updateMatrixWorld()
    return {
      serial: ++serial,
      actorId: 3,
      deltaSeconds: 0,
      camera: local,
      sceneCamera: camera,
      centerWorld: new Vector3(),
      planetRotation: new Quaternion(),
      datumRadiusMeters: radius,
      viewport: new Vector2(33, 33),
      sunDirection: new Vector3(0, 0, 1),
      lightColor: new Color(0.7, 0.8, 0.9),
      lambert: 0
    }
  }
  let f = frame()
  const model = actor(),
    sphere = new SphereSurfaceMaterial(model),
    terrain = new TerrainMaterial(model),
    water = new WaterMaterial(model)
  const materials = [sphere, terrain, water]
  const geometry = new SphereGeometry(radius * unit, 192, 96)
  const shoreGeometry = geometry.clone()
  const ground = new Mesh<SphereGeometry, ShaderMaterial>(geometry, terrain),
    sea = new Mesh(geometry, water)
  ground.scale.setScalar(0.92)
  scene.add(ground, sea)
  water.defaultAttributeValues = { ...water.defaultAttributeValues, patchCenter: [0, 0, 0], detailOrigin: [0, 0, 0] }
  for (const m of materials) {
    m.toneMapped = false
    m.uniforms.lightPosition.value.set(0, 0, 1000)
    if (m.uniforms.uWaterGlintGain) m.uniforms.uWaterGlintGain.value = 0
  }
  const base = new DataTexture(new Uint8Array([76, 102, 51, 255]), 1, 1)
  base.colorSpace = LinearSRGBColorSpace
  base.needsUpdate = true
  sphere.uniforms.diffuseMap.value = terrain.uniforms.diffuseMap.value = base
  const pixels = new Uint8Array([
    20, 50, 90, 255, 100, 30, 10, 255, 60, 110, 50, 255, 12, 80, 25, 255, 90, 40, 100, 255, 30, 90, 50, 255, 80, 80, 10,
    255, 50, 20, 75, 255
  ])
  const mapTexture = new DataTexture(pixels, 4, 2)
  mapTexture.colorSpace = LinearSRGBColorSpace
  mapTexture.magFilter = mapTexture.minFilter = NearestFilter
  mapTexture.wrapS = RepeatWrapping
  mapTexture.needsUpdate = true
  const map: SurfaceCloudMap = {
    pattern: { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId: 26 } },
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0.18 },
    color: { kind: 'constant', srgb: [1, 1, 1] }
  }
  const shadowTexture = new DataArrayTexture(new Float32Array([0, 0.001, 1.5, 0]), 1, 1, 1)
  shadowTexture.type = FloatType
  shadowTexture.needsUpdate = true
  const noise = new Data3DTexture(new Uint8Array([0]), 1, 1, 1)
  noise.format = RedFormat
  noise.needsUpdate = true
  const shadowMatrix = new Matrix4().makeScale(1e-8, 1e-8, 1e-8)
  const output = (): SceneCloudOutput => ({
    frame: f,
    atmosphereActorId: 4,
    atmosphereGeneration: 1,
    atmosphereBottomRadiusMeters: 6360000,
    historyGeneration: 0,
    overlay: base,
    stbn: noise,
    shadow: {
      map: shadowTexture,
      mapSize: new Vector2(1, 1),
      cascadeCount: 1,
      intervals: [new Vector2(0, 1)],
      matrices: [shadowMatrix],
      inverseMatrices: [shadowMatrix.clone().invert()],
      far: 1e8,
      topHeight: 30000
    }
  })
  const borrowed = [base, mapTexture, shadowTexture, noise]
  let borrowedDisposals = 0
  borrowed.forEach((t) => t.addEventListener('dispose', () => borrowedDisposals++))
  const read = (): Float32Array => {
    renderer.setRenderTarget(target)
    renderer.clear()
    const bindings = new Map(
      materials.map((m) => [
        m,
        m.sceneCloudReceiver.getEndpointMaterial(m.uniforms.sceneCloudShadowEnabled.value ? 'near' : 'far')
      ])
    )
    withSceneCloudMaterials(scene, bindings, () => renderer.render(scene, camera))
    const result = new Float32Array(33 * 33 * 4)
    renderer.readRenderTargetPixels(target, 0, 0, 33, 33, result)
    return result
  }
  const sample = (data: Float32Array, x = 16, y = 16) => Array.from(data.slice((y * 33 + x) * 4, (y * 33 + x) * 4 + 3))
  const setMap = (value: SurfaceCloudMap | null) =>
    materials.forEach((m) => {
      m.sceneCloudReceiver.setFarMap(value, value ? mapTexture : null)
      m.sceneCloudReceiver.setEndpoint(f, null)
    })
  const oracle = (x: number, y: number): { coverage: number; cloud: number[] } => {
    const ray = new Vector3(((x + 0.5) / 33) * 2 - 1, ((y + 0.5) / 33) * 2 - 1, 0.5)
      .unproject(f.camera)
      .sub(f.camera.position)
      .normalize()
    const b = f.camera.position.dot(ray),
      c = f.camera.position.lengthSq() - radius * radius
    const hit = f.camera.position
      .clone()
      .addScaledVector(ray, -b - Math.sqrt(b * b - c))
      .normalize()
      .applyQuaternion(f.planetRotation.clone().invert())
    const u = ((((Math.atan2(hit.z, -hit.x) + map.mapping.longitudeOffsetRadians) / (2 * Math.PI)) % 1) + 1) % 1
    const v = 1 - Math.acos(hit.y) / Math.PI,
      index = (Math.min(1, Math.floor(v * 2)) * 4 + Math.min(3, Math.floor(u * 4))) * 4
    const rgb = Array.from(pixels.slice(index, index + 3), (value) => value / 255),
      coverage = Math.sqrt((rgb[0] + rgb[1] + rgb[2]) / 3)
    return { coverage, cloud: rgb.map((value, channel) => Math.min(value / coverage, 1) * [0.7, 0.8, 0.9][channel]) }
  }
  try {
    // RGB source is the original sampler. A separately authored white near color must not whiten it.
    for (const angle of [0, 0.8]) {
      f = frame()
      f.planetRotation.setFromAxisAngle(new Vector3(0, 1, 0), angle)
      ground.quaternion.copy(f.planetRotation)
      sea.quaternion.copy(f.planetRotation)
      for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
        water.uniforms.uWaterAlphaDeep.value = alpha
        setMap(null)
        const baseline = read()
        setMap(map)
        const colored = read()
        for (const [x, y] of [
          [16, 16],
          [13, 17],
          [18, 14]
        ]) {
          const expected = oracle(x, y),
            before = sample(baseline, x, y),
            after = sample(colored, x, y)
          after.forEach((value, channel) =>
            close(
              value,
              before[channel] * (1 - expected.coverage) + expected.cloud[channel] * expected.coverage,
              `one coverage angle=${angle} alpha=${alpha} xy=${x},${y} before=${before} oracle=${JSON.stringify(expected)} after=${after}`
            )
          )
        }
      }
    }
    report.cases.push('transparent-water-single-coverage', 'oblique-datum', 'body-rotation', 'rgb-original-source')
    sea.visible = false
    ground.scale.setScalar(1)
    setMap(map)
    const terrainFar = sample(read())
    ground.material = sphere
    const sphereFar = sample(read())
    terrainFar.forEach((v, i) => close(v, sphereFar[i], 'sphere-terrain-uv-handoff'))
    report.cases.push('sphere-terrain-uv-handoff')
    // Sloped controlled terrain crosses the actual transparent water geometry.
    const positions = shoreGeometry.getAttribute('position')
    const point = new Vector3()
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i)
      const offset = point.x / (radius * unit) - 0.38
      point.multiplyScalar(1 + offset * 0.12)
      positions.setXYZ(i, point.x, point.y, point.z)
    }
    positions.needsUpdate = true
    ground.material = terrain
    ground.geometry = shoreGeometry
    sea.visible = true
    ground.scale.setScalar(1)
    ground.quaternion.identity()
    sea.quaternion.identity()
    f = frame()
    water.uniforms.uWaterAlphaDeep.value = 0.5
    setMap(null)
    const shoreBase = read()
    setMap(map)
    const shoreCloud = read()
    for (const [x, y] of [
      [10, 16],
      [16, 16],
      [22, 16]
    ]) {
      const expected = oracle(x, y),
        before = sample(shoreBase, x, y),
        after = sample(shoreCloud, x, y)
      after.forEach((v, i) =>
        close(v, before[i] * (1 - expected.coverage) + expected.cloud[i] * expected.coverage, 'intersecting shoreline')
      )
    }
    ground.geometry = geometry
    report.cases.push('shoreline')
    // Scalar decoding and authored mapped color are independently specified from RGB-cloud decoding.
    sea.visible = false
    ground.material = terrain
    const scalar: SurfaceCloudMap = {
      ...map,
      pattern: {
        kind: 'mask',
        map: { resourceId: 26 },
        decode: { channel: 'g', inputRange: [0, 1], exponent: 2, invert: true, sampleSpace: 'linear' }
      },
      color: { kind: 'constant', srgb: [1, 1, 1] }
    }
    setMap(null)
    const scalarBase = sample(read())
    terrain.sceneCloudReceiver.setFarMap(scalar, mapTexture)
    const whiteScalar = sample(read())
    const rgbOracle = oracle(16, 16),
      g = (rgbOracle.cloud[1] * rgbOracle.coverage) / 0.8
    const scalarCoverage = (1 - g) ** 2
    whiteScalar.forEach((v, i) =>
      close(
        v,
        scalarBase[i] * (1 - scalarCoverage) + [0.7, 0.8, 0.9][i] * scalarCoverage,
        'scalar green invert exponent'
      )
    )
    const mapped: SurfaceCloudMap = { ...scalar, color: { kind: 'map', map: { resourceId: 27 }, strength: 0.4 } }
    terrain.sceneCloudReceiver.setFarMap(mapped, mapTexture)
    sample(read()).forEach((v, i) => close(v, scalarBase[i], 'missing color resource disables contribution'))
    terrain.sceneCloudReceiver.setFarMap(mapped, mapTexture, base)
    sample(read()).forEach((v, i) =>
      close(
        v,
        scalarBase[i] * (1 - scalarCoverage) +
          (1 - 0.4 + (0.4 * [76, 102, 51][i]) / 255) * [0.7, 0.8, 0.9][i] * scalarCoverage,
        'different authored color source strength'
      )
    )
    const same: SurfaceCloudMap = { ...scalar, color: { kind: 'map', map: { resourceId: 26 }, strength: 0.4 } }
    terrain.sceneCloudReceiver.setFarMap(same, mapTexture)
    sample(read()).forEach((v, i) =>
      close(
        v,
        scalarBase[i] * (1 - scalarCoverage) +
          (1 - 0.4 + (0.4 * rgbOracle.cloud[i] * rgbOracle.coverage) / [0.7, 0.8, 0.9][i]) *
            [0.7, 0.8, 0.9][i] *
            scalarCoverage,
        'same authored color source'
      )
    )
    report.cases.push('scalar-decoding', 'scalar-color-same-different-missing')
    // Near endpoint uses a controlled optical-depth texture through the production guarded sampler.
    for (const material of materials) {
      ground.material = material
      ground.scale.setScalar(1)
      sea.visible = false
      material.sceneCloudReceiver.setFarMap(null, null)
      f = frame()
      f.lambert = 1
      material.sceneCloudReceiver.setEndpoint(f, { ...output(), shadow: null })
      const direct = sample(read())
      material.sceneCloudReceiver.setEndpoint(f, output())
      const shadowed = sample(read())
      check(
        shadowed.some((v, i) => v < direct[i] - 0.001),
        `direct attenuated ${material.constructor.name}`
      )
      if (material !== water) {
        material.defines.USE_LIGHT_TINT = 1
        material.uniforms.uLightColor.value.setRGB(0, 0, 0)
        material.needsUpdate = true
        material.sceneCloudReceiver.setEndpoint(f, { ...output(), shadow: null })
        const ambient = sample(read())
        material.sceneCloudReceiver.setEndpoint(f, output())
        const ambientShadow = sample(read())
        check(
          ambient.some((v) => v > 0.001),
          'ambient control is nonzero'
        )
        ambient.forEach((v, i) => close(v, ambientShadow[i], 'ambient unchanged', 0.00001))
        delete material.defines.USE_LIGHT_TINT
        material.uniforms.uLightColor.value.setRGB(1, 1, 1)
        material.needsUpdate = true
        material.defines.USE_NIGHT = 1
        material.uniforms.nightMap.value = base
        material.needsUpdate = true
      }
      // Direct vanishes on the night side; its emission / water floor is unchanged.
      material.uniforms.lightPosition.value.set(0, 0, -1000)
      material.sceneCloudReceiver.setEndpoint(f, { ...output(), shadow: null })
      const night = sample(read())
      material.sceneCloudReceiver.setEndpoint(f, output())
      const nightShadow = sample(read())
      night.forEach((v, i) => close(v, nightShadow[i], `night unchanged ${material.constructor.name}`, 0.00001))
      material.uniforms.lightPosition.value.set(0, 0, 1000)
      material.sceneCloudReceiver.setEndpoint(null, null)
    }
    report.cases.push('sphere-shadow', 'terrain-shadow', 'water-shadow', 'night-only', 'ambient-only', 'direct-only')
    // Isolate actual sphere/water glints with black diffuse/reflection colors.
    const black = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1),
      white = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    black.needsUpdate = white.needsUpdate = true
    try {
      camera.position.set(0, 0, 1.7 * radius * unit)
      camera.lookAt(0, 0, 0)
      f = frame()
      f.lambert = 1
      for (const material of [sphere, water]) {
        ground.material = material
        material.uniforms.uWaterGlintGain.value = 1
        if (material === sphere) {
          material.uniforms.diffuseMap.value = black
          material.uniforms.specularMap.value = white
          material.defines.USE_SPECULAR = 1
          material.needsUpdate = true
        } else {
          material.uniforms.uWaterColor.value.setRGB(0, 0, 0)
          material.uniforms.uWaterFresnelTint.value.setRGB(0, 0, 0)
          material.uniforms.uWaterNightFloor.value = 0
        }
        material.sceneCloudReceiver.setEndpoint(f, { ...output(), shadow: null })
        const glint = sample(read())
        material.sceneCloudReceiver.setEndpoint(f, output())
        const dimGlint = sample(read())
        check(
          glint.some((v) => v > 0.0001),
          'glint control is nonzero'
        )
        check(
          dimGlint.some((v, i) => v < glint[i] * 0.7),
          'direct glint attenuated'
        )
      }
    } finally {
      black.dispose()
      white.dispose()
    }
    report.cases.push('glint-only')
    // The same owner accepts fresh transformed shadow matrices after camera/body motion.
    const moving = new DataArrayTexture(new Float32Array([0, 0.001, 1.5, 0, 0, 0, 0, 0]), 2, 1, 1)
    moving.type = FloatType
    moving.needsUpdate = true
    try {
      ground.material = terrain
      ground.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.9)
      camera.position.set(0.4 * radius * unit, 0, 1.7 * radius * unit)
      camera.lookAt(0, 0, 0)
      f = frame()
      f.planetRotation.copy(ground.quaternion)
      f.lambert = 1
      terrain.uniforms.sceneCloudShadowShadowRadius.value = 0
      const movingOutput = output()
      movingOutput.shadow!.map = moving
      movingOutput.shadow!.mapSize.set(2, 1)
      const matrix = movingOutput.shadow!.matrices[0].clone()
      matrix.elements[12] = -0.7
      movingOutput.shadow!.matrices = [matrix]
      terrain.sceneCloudReceiver.setEndpoint(f, movingOutput)
      const left = sample(read())
      matrix.elements[12] = 0.7
      terrain.sceneCloudReceiver.setEndpoint(f, movingOutput)
      const right = sample(read())
      check(
        right.some((v, i) => v > left[i] + 0.005),
        'current matrices move shadow after body/camera rotation'
      )
    } finally {
      moving.dispose()
    }
    report.cases.push('moving-shadow')
    materials.forEach((m) => m.dispose())
    check(borrowedDisposals === 0, 'receiver owners preserve all borrowed sources/shadow/noise')
    report.cases.push('borrowed-ownership')
    report.resourcesReleased = true
  } finally {
    materials.forEach((m) => m.dispose())
    borrowed.forEach((t) => t.dispose())
    geometry.dispose()
    shoreGeometry.dispose()
    target.dispose()
    renderer.dispose()
  }
  return report
}
