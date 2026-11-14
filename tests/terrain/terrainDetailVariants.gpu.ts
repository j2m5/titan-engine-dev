import { Actor } from '@/core/models/Actor'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { Float32BufferAttribute, Mesh, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three'

/** Detail can arrive before slope, and can be used without macro/frost/water effects. */
export function checkTerrainDetailVariants() {
  const renderer = new WebGLRenderer()
  renderer.setSize(1, 1)
  renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
    throw new Error(`Terrain detail-only shader: ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`)
  }
  const geometry = new PlaneGeometry(2, 2)
  geometry.setAttribute('height', new Float32BufferAttribute([2000, 2000, 2000, 2000], 1))
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  const scene = new Scene()
  let checks = 0
  try {
    for (const body of [8, 19])
      for (const slope of [false, true]) {
        const material = new TerrainMaterial(Actor.find(body)!)
        try {
          for (const key of [
            'USE_TERRAIN_MACRO_DETAIL',
            'USE_WATER_EDGE',
            'USE_FROST',
            'USE_TERRAIN_FROST',
            'USE_TERRAIN_SHADOW',
          'USE_SLOPE'
          ])
            delete material.defines[key]
          material.defines.USE_TERRAIN_DETAIL = true
        if (slope) material.defines.USE_SLOPE = true
        if (body === 8) material.defines.USE_TERRAIN_TALUS = true
          const mesh = new Mesh(geometry, material)
          mesh.position.z = -2
          mesh.frustumCulled = false
          scene.add(mesh)
          renderer.render(scene, camera)
          scene.remove(mesh)
          if (renderer.getContext().getError() !== 0) throw new Error('Terrain variant GL error')
          checks++
        } finally {
          material.dispose()
        }
      }
    return { checks }
  } finally {
    geometry.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
