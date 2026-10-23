import {
  DepthTexture, FloatType, Group, IcosahedronGeometry, Matrix4, Mesh, OrthographicCamera,
  PerspectiveCamera, PlaneGeometry, ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

/** Compare the real asteroid program and depth, with allocations fixed across view changes. */
function checkLayerVisibility(layer: 'near' | 'l0'): Record<string, { submitted: number; reference: number; different: number }> {
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setSize(128, 128)
  const target = new WebGLRenderTarget(128, 128, { type: FloatType })
  target.depthTexture = new DepthTexture(128, 128)
  const depthTarget = new WebGLRenderTarget(128, 128, { type: FloatType, depthBuffer: false })
  const depthMaterial = new ShaderMaterial({
    uniforms: { map: { value: target.depthTexture } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUV; void main(){vUV=uv; gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUV; void main(){gl_FragColor=vec4(texture2D(map,vUV).rrr,1.0);}'
  })
  const blit = new Mesh(new PlaneGeometry(2, 2), depthMaterial)
  const blitCamera = new OrthographicCamera(), camera = new PerspectiveCamera(60, 1, 0.1, 100)
  const shape = new IcosahedronGeometry(0.7, 2)
  const pools = [0, 1].map(() => new InstancePool({ maxInstances: 32 }, { maxInstances: 32 }, { maxInstances: 1 }, [shape], [shape], 1, undefined, false, false, true))
  const streamOf = (pool: InstancePool) => layer === 'near' ? pool.nearStreamBase : 0
  const groups = pools.map(pool => { const group = new Group(); group.add(layer === 'near' ? pool.nearMeshes[0] : pool.geometryMeshes[0]); return group })
  const results: Record<string, { submitted: number; reference: number; different: number }> = {}
  const positions = [[0, 0, -5], [0, 0, 5], [2.7, 0, -5], [-2.7, 0, -5], [0, 2.7, -5], [0, -2.7, -5], [20, 0, -5], [-20, 0, -5]]
  for (const pool of pools) {
    for (const [i, xyz] of positions.entries()) {
      const allocation = pool.allocate(streamOf(pool), 1)!
      pool.writeMatrices(allocation.stream, allocation.offset, new Float32Array(new Matrix4().makeTranslation(...xyz as [number, number, number]).elements))
      pool.writeFade(allocation.stream, allocation.offset, 1, i === 2 ? -0.5 : 0.8)
      pool.writeDetailEnd(allocation, 20); pool.writeDetailMix(allocation, 0.8)
    }
    pool.commitUpdates()
    const u = pool.geometryMaterial.uniforms
    u.uShapeAmpMin.value = -0.2; u.uShapeAmpMax.value = 0.2
    u.uSpinPeriod.value = 10; u.uSpinTime.value = 2.7
    u.uSurfaceAmbient.value = 0.3
    u.lightPosition.value.set(3, 5, 1)
  }
  const read = (output: WebGLRenderTarget) => {
    const pixels = new Float32Array(128 * 128 * 4)
    renderer.readRenderTargetPixels(output, 0, 0, 128, 128, pixels)
    if (pixels.some(x => !Number.isFinite(x))) throw new Error('Nonfinite asteroid pixels')
    return pixels
  }
  const render = (index: number) => {
    renderer.setRenderTarget(target); renderer.setClearColor(0, 0); renderer.clear()
    renderer.render(groups[index], camera)
    const triangles = renderer.info.render.triangles, color = read(target)
    renderer.setRenderTarget(depthTarget); renderer.render(blit, blitCamera)
    return { triangles, color, depth: read(depthTarget) }
  }
  const check = (name: string) => {
    camera.updateMatrixWorld(true)
    pools[1].updateGeometryVisibility(camera)
    const baseline = render(0), compact = render(1)
    let different = 0, covered = 0
    for (let i = 0; i < baseline.color.length; i++) {
      if (baseline.color[i] !== compact.color[i] || baseline.depth[i] !== compact.depth[i]) different++
      if (i % 4 === 3 && baseline.color[i] > 0) covered++
    }
    if (!covered) throw new Error(`${name}: empty reference image`)
    if (different) throw new Error(`${name}: ${different} color/depth components differ`)
    if (compact.triangles >= baseline.triangles) throw new Error(`${layer}/${name}: no submitted geometry saved`)
    if (renderer.getContext().getError()) throw new Error(`${name}: WebGL error`)
    results[name] = { submitted: compact.triangles, reference: baseline.triangles, different }
  }
  let replacement: IcosahedronGeometry | undefined
  try {
    check('front displaced spinning shapes')
    camera.rotation.y = Math.PI
    check('turn to previously hidden slots')
    camera.rotation.y = 0
    for (let i = 0; i < groups.length; i++) {
      groups[i].position.set(1e8, 2e8, -3e8)
      groups[i].scale.set(1.1, 0.9, 1.2)
    }
    camera.position.copy(groups[0].position)
    check('large world coordinates and scale')
    const shift = new Vector3(100, 20, 40)
    for (const [i, pool] of pools.entries()) {
      groups[i].position.add(shift.clone().multiply(groups[i].scale))
      pool.writeOrigins(streamOf(pool), 0, positions.length, shift.clone().negate())
      pool.commitUpdates()
    }
    check('floating origin rebase')
    replacement = new IcosahedronGeometry(0.9, 2).translate(-0.4, 0, 0)
    for (const pool of pools) pool.replaceArchetypeGeometry(0, replacement, replacement)
    check('off-center geometry replacement')
    return results
  } finally {
    for (const pool of pools) {
      for (const mesh of [...pool.geometryMeshes, ...pool.nearMeshes, pool.billboardMesh]) { mesh.dispose(); mesh.geometry.dispose() }
      pool.geometryMaterial.dispose(); pool.billboardMaterial.dispose()
    }
    shape.dispose(); replacement?.dispose(); blit.geometry.dispose(); depthMaterial.dispose()
    target.dispose(); depthTarget.dispose(); renderer.dispose()
  }
}

export function checkGeometryVisibility() {
  return { near: checkLayerVisibility('near'), l0: checkLayerVisibility('l0') }
}
