import {
  Camera, DataArrayTexture, DepthTexture, Euler, FloatType, IcosahedronGeometry, Matrix4,
  Mesh, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Quaternion, ShaderMaterial,
  Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import { createImpostorLayout } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'

interface Fixture {
  name: string
  position: [number, number, number]
  scale?: [number, number, number]
  rotation?: [number, number, number]
  matrix?: Matrix4
  camera?: Camera
  world?: [number, number, number]
  origin?: [number, number, number]
  fade?: number
  ready?: number
  detailEnd?: number
  spin?: number
  visible?: boolean
  reject?: boolean
}

/** Real pool compaction versus untouched allocation buffers, with full capture
 * tiles so corners outside the physical model sphere remain observable. */
export function checkImpostorVisibility() {
  const size = 96, layout = createImpostorLayout(8, 1)
  const data = (texel: number[]) => {
    const pixels = new Float32Array(layout.pageSize ** 2 * 4)
    for (let i = 0; i < pixels.length; i += 4) pixels.set(texel, i)
    const texture = new DataArrayTexture(pixels, layout.pageSize, layout.pageSize, 1)
    texture.type = FloatType; texture.needsUpdate = true
    return texture
  }
  const normalDepth = data([.5, .5, 1, .5]), surfaceCoverage = data([.25, .1, 0, 1])
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setSize(size, size)
  const target = new WebGLRenderTarget(size, size, { type: FloatType })
  target.depthTexture = new DepthTexture(size, size)
  const depthTarget = new WebGLRenderTarget(size, size, { type: FloatType, depthBuffer: false })
  const depthMaterial = new ShaderMaterial({
    uniforms: { map: { value: target.depthTexture } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUV; void main(){vUV=uv; gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUV; void main(){gl_FragColor=vec4(texture2D(map,vUV).rrr,1.0);}'
  })
  const blit = new Mesh(new PlaneGeometry(2, 2), depthMaterial), blitCamera = new OrthographicCamera()
  const shape = new IcosahedronGeometry(1, 0)
  const pools = [0, 1].map(() => {
    const pool = new InstancePool({ maxInstances: 1 }, { maxInstances: 1 }, { maxInstances: 8 }, [shape], [shape], 1, undefined, true, true, true)
    pool.billboardMaterial.setImpostorSnapshot({ generation: 1, state: 'ready', reason: null, revisions: [],
      slotLayers: new Int32Array([0]), halfExtents: new Float32Array([1]),
      atlas: { normalDepth, surfaceCoverage, layout, layerCount: 1, dispose() {} } })
    const u = pool.billboardMaterial.uniforms
    u.uLightPosition.value.set(3, 5, 10); u.uPlanetshineStrength.value = 0; u.uSurfaceAmbient.value = .3
    return pool
  })
  const perspective = new PerspectiveCamera(60, 1, .001, 1000)
  const offset = new PerspectiveCamera(60, 1, .001, 1000)
  offset.setViewOffset(192, 128, 55, 23, 96, 96)
  const ortho = new OrthographicCamera(-2, 3, 2.5, -1.5, .001, 1000)
  const fixtures: Fixture[] = [
    { name: 'center', position: [0, 0, -5], visible: true },
    ...[[10, 0, -.01], [-10, 0, -.01], [0, 10, -.01], [0, -10, -.01]].map((position, i) =>
      ({ name: `side-on outside ${i}`, position: position as Fixture['position'], scale: [.05, .04, .06] as Fixture['scale'], reject: true })),
    { name: 'rear', position: [0, 0, 5], scale: [.1, .1, .1], reject: true },
    ...[[3.1, 0, -5], [-3.1, 0, -5], [0, 3.1, -5], [0, -3.1, -5]].map((position, i) =>
      ({ name: `edge overlap ${i}`, position: position as Fixture['position'], visible: true })),
    { name: 'off-axis right edge', position: [2.4, 0, -5], scale: [.05, .05, .05], camera: offset, visible: true },
    { name: 'off-axis bottom edge', position: [0, -2.4, -5], scale: [.05, .05, .05], camera: offset, visible: true },
    { name: 'orthographic edge', position: [3.2, 0, -5], camera: ortho, visible: true },
    { name: 'nonuniform spinning shape', position: [2.8, 0, -5], scale: [.6, 1.4, .8], rotation: [.3, .7, .4], spin: 2.7, visible: true },
    { name: 'reflected scale', position: [-2.8, 0, -5], scale: [-.8, 1.2, .6], rotation: [.4, -.2, .6], visible: true },
    { name: 'shear', position: [0, 0, -5], matrix: new Matrix4().set(1, 1.5, .4, 2.5, 0, 1, .2, 0, 0, 0, 1, -5, 0, 0, 0, 1), visible: true },
    { name: 'large world coordinates', position: [0, 0, -5], world: [1e8, -2e8, 3e8], visible: true },
    { name: 'floating origin', position: [-100, -20, 35], origin: [100, 20, -40], visible: true },
    { name: 'positive crossfade', position: [0, 0, -5], fade: .4, visible: true },
    { name: 'negative crossfade', position: [0, 0, -5], fade: -.4, visible: true },
    { name: 'zero fade', position: [0, 0, -5], fade: 0 },
    { name: 'atlas readiness lost after compaction', position: [0, 0, -5], ready: 0, visible: true },
    { name: 'legacy detail-end', position: [0, 0, -5], detailEnd: 0, visible: true },
    { name: 'near clipping unchanged', position: [0, 0, -.0005] },
    { name: 'far clipping unchanged', position: [0, 0, -1100] },
    { name: 'capture square corner beyond sphere', position: [4.469101615137754, .4375759591348469, -5],
      rotation: [2.1606317508965733, 2.927667987747118, 4.799811640847475], visible: true },
    { name: 'second capture square corner', position: [4.469101615137754, .36847608583047986, -5],
      rotation: [3.6618274826556445, .1530742559861392, 5.24845219777897], visible: true }
  ]
  const read = (output: WebGLRenderTarget) => {
    const pixels = new Float32Array(size * size * 4)
    renderer.readRenderTargetPixels(output, 0, 0, size, size, pixels)
    if (pixels.some(value => !Number.isFinite(value))) throw new Error('Nonfinite impostor pixels')
    return pixels
  }
  const render = (pool: InstancePool, camera: Camera) => {
    renderer.setRenderTarget(target); renderer.setClearColor(0, 0); renderer.clear(); renderer.render(pool.billboardMesh, camera)
    const color = read(target), triangles = renderer.info.render.triangles
    renderer.setRenderTarget(depthTarget); renderer.render(blit, blitCamera)
    return { color, depth: read(depthTarget), triangles, covered: color.filter((value, i) => i % 4 === 3 && value > 0).length }
  }
  const results = []
  try {
    for (const fixture of fixtures) {
      const camera = fixture.camera ?? perspective
      camera.position.set(...(fixture.world ?? [0, 0, 0])); camera.updateMatrixWorld(true)
      for (const pool of pools) {
        pool.reset()
        pool.billboardMesh.position.copy(camera.position)
        const matrix = fixture.matrix ?? new Matrix4().compose(new Vector3(...fixture.position),
          new Quaternion().setFromEuler(new Euler(...(fixture.rotation ?? [0, 0, 0]))), new Vector3(...(fixture.scale ?? [1, 1, 1])))
        for (const [i, transform] of [matrix, new Matrix4().makeTranslation(100, 100, -5)].entries()) {
          const allocation = pool.allocate(pool.billboardStream, 1)!
          pool.writeMatrices(allocation.stream, allocation.offset, new Float32Array(transform.elements))
          pool.writeOrigins(allocation.stream, allocation.offset, 1, new Vector3(...(i ? [0, 0, 0] : fixture.origin ?? [0, 0, 0])))
          pool.writeFade(allocation.stream, allocation.offset, 1, i ? 1 : fixture.fade ?? 1)
          pool.writeMaxDistance(allocation.stream, allocation.offset, 1, 2000)
          pool.writeArchetypes(allocation, new Int32Array([0])); pool.writeDetailEnd(allocation, i ? 1 : fixture.detailEnd ?? 1)
        }
        pool.commitUpdates()
        const u = pool.billboardMaterial.uniforms
        u.uImpostorReady.value = fixture.ready ?? 1
        u.uOriginOffset.value.set(...(fixture.origin ?? [0, 0, 0]))
        u.uSpinPeriod.value = fixture.spin === undefined ? 0 : 10; u.uSpinTime.value = fixture.spin ?? 0
      }
      pools[1].updateVisibility(camera)
      const reference = render(pools[0], camera), actual = render(pools[1], camera)
      let differentBits = 0
      for (const key of ['color', 'depth'] as const) {
        const expected = new Uint32Array(reference[key].buffer), received = new Uint32Array(actual[key].buffer)
        for (let i = 0; i < expected.length; i++) if (expected[i] !== received[i]) differentBits++
      }
      if (differentBits) throw new Error(`${fixture.name}: ${differentBits} color/depth components differ`)
      if (fixture.visible && !reference.covered) throw new Error(`${fixture.name}: empty reference coverage`)
      if (fixture.reject && pools[1].billboardMesh.count !== 0) throw new Error(`${fixture.name}: offscreen instances still submitted`)
      if (fixture.ready === 0 ? actual.triangles !== reference.triangles : actual.triangles >= reference.triangles) throw new Error(`${fixture.name}: unexpected submission count`)
      results.push({ name: fixture.name, covered: reference.covered, differentBits, submitted: actual.triangles, reference: reference.triangles })
    }
    if (renderer.getContext().getError()) throw new Error('Impostor visibility WebGL error')
    return { resolution: size, results }
  } finally {
    renderer.setRenderTarget(null)
    for (const pool of pools) {
      for (const mesh of [...pool.geometryMeshes, ...pool.nearMeshes, pool.billboardMesh]) { mesh.dispose(); mesh.geometry.dispose() }
      pool.geometryMaterial.dispose(); pool.billboardMaterial.dispose()
    }
    shape.dispose(); normalDepth.dispose(); surfaceCoverage.dispose(); blit.geometry.dispose(); depthMaterial.dispose()
    target.dispose(); depthTarget.dispose(); renderer.dispose(); renderer.forceContextLoss()
  }
}
