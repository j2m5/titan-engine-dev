import {
  DepthTexture, FloatType, Group, Matrix4, Mesh, OrthographicCamera, PerspectiveCamera,
  PlaneGeometry, ShaderMaterial, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import { buildArchetypeGeometry } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeGeometry'
import { ArchetypeShape, generateArchetypeParams, type ArchetypeMorphology } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeShape'
import { SeededRandom } from '@/core/renderables/DetailedRingStreamingSystem/SeededRandom'
import { buildArchetypeGeometry as buildOriginalGeometry } from './nonIndexedGeometryReference'

/** Compare original triangle soup and indexed production geometry in the real material. */
export function checkArchetypeIndexing() {
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
  const blit = new Mesh(new PlaneGeometry(2, 2), depthMaterial), blitCamera = new OrthographicCamera()
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  const morphologies: ArchetypeMorphology[] = ['fragment', 'rubble', 'binary', 'top', 'cratered']
  const results = []
  const read = (output: WebGLRenderTarget) => {
    const pixels = new Float32Array(128 * 128 * 4)
    renderer.readRenderTargetPixels(output, 0, 0, 128, 128, pixels)
    if (pixels.some(value => !Number.isFinite(value))) throw new Error('Nonfinite indexing pixels')
    return pixels
  }
  const render = (group: Group) => {
    renderer.setRenderTarget(target); renderer.setClearColor(0, 0); renderer.clear(); renderer.render(group, camera)
    const triangles = renderer.info.render.triangles, color = read(target)
    renderer.setRenderTarget(depthTarget); renderer.render(blit, blitCamera)
    return { triangles, color, depth: read(depthTarget) }
  }
  try {
    for (const morphology of morphologies) for (const detail of [3, 7]) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(9137), morphology))
      const geometries = [buildOriginalGeometry(shape, detail, 0.7), buildArchetypeGeometry(shape, detail, 0.7)]
      const pools = geometries.map(geometry => new InstancePool({ maxInstances: 8 }, { maxInstances: 8 }, { maxInstances: 1 }, [geometry], [geometry], 1, undefined, false, false, true))
      const groups = pools.map(pool => new Group().add(detail === 7 ? pool.nearMeshes[0] : pool.geometryMeshes[0]))
      try {
        const originalVertices = geometries[0].getAttribute('position').count, indexedVertices = geometries[1].getAttribute('position').count
        if (indexedVertices >= originalVertices || geometries[1].index?.count !== originalVertices) throw new Error('Indexing did not reuse vertices or changed tessellation')
        for (const pool of pools) {
          const stream = detail === 7 ? pool.nearStreamBase : 0
          for (const [i, xyz] of [[-1.2, -0.8, -5], [1.2, -0.8, -5], [-1.2, 0.8, -5], [1.2, 0.8, -5], [2.6, 0, -5]].entries()) {
            const allocation = pool.allocate(stream, 1)!
            pool.writeMatrices(stream, allocation.offset, new Float32Array(new Matrix4().makeTranslation(...xyz as [number, number, number]).elements))
            pool.writeFade(stream, allocation.offset, 1, [1, 0.4, -0.6, 0, 1][i])
            pool.writeDetailEnd(allocation, 7); pool.writeDetailMix(allocation, [1, 0.5, 0, 1, 0.75][i])
          }
          pool.commitUpdates()
          const u = pool.geometryMaterial.uniforms
          u.uShapeAmpMin.value = -0.2; u.uShapeAmpMax.value = 0.2
          u.uSpinPeriod.value = 10; u.uSurfaceAmbient.value = 0.3
          u.lightPosition.value.set(3, 5, 1)
        }
        for (const ready of [0, 1]) {
          for (const [i, pool] of pools.entries()) {
            pool.geometryMaterial.uniforms.uImpostorReady.value = ready
            pool.geometryMaterial.uniforms.uLodVolumetric.value = ready
            pool.geometryMaterial.uniforms.uSpinTime.value = ready * 2.7
            groups[i].position.set(ready * 1e8, ready * 2e8, ready * -3e8)
            groups[i].scale.set(1.1, 0.9, 1.2)
          }
          camera.position.copy(groups[0].position); camera.updateMatrixWorld(true)
          const original = render(groups[0]), indexed = render(groups[1])
          let differentBits = 0, covered = 0, depthCovered = 0
          for (const name of ['color', 'depth'] as const) {
            const a = new Uint32Array(original[name].buffer), b = new Uint32Array(indexed[name].buffer)
            for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differentBits++
          }
          for (let i = 0; i < original.color.length; i += 4) {
            if (original.color[i + 3] > 0) covered++
            if (original.depth[i] < 1) depthCovered++
          }
          if (!covered || !depthCovered || differentBits || original.triangles !== indexed.triangles || renderer.getContext().getError()) {
            throw new Error(`${morphology}/${detail}/ready${ready}: invalid parity: ${JSON.stringify({ covered, depthCovered, differentBits, triangles: [original.triangles, indexed.triangles] })}`)
          }
          results.push({ morphology, detail, ready, originalVertices, indexedVertices, triangles: indexed.triangles, covered, depthCovered, differentBits })
        }
      } finally {
        for (const pool of pools) {
          for (const mesh of [...pool.geometryMeshes, ...pool.nearMeshes, pool.billboardMesh]) { mesh.dispose(); mesh.geometry.dispose() }
          pool.geometryMaterial.dispose(); pool.billboardMaterial.dispose()
        }
        geometries.forEach(geometry => geometry.dispose())
      }
    }
    return results
  } finally {
    renderer.setRenderTarget(null)
    blit.geometry.dispose(); depthMaterial.dispose(); target.dispose(); depthTarget.dispose(); renderer.dispose(); renderer.forceContextLoss()
  }
}
