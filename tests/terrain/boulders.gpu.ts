import { Actor } from '@/core/models/Actor'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { TerrainBoulderMaterial, createBoulderContactMaterial } from '@/core/materials/TerrainBoulderMaterial'
import { createBoulderGeometry } from '@/core/terrain/boulderGeometry'
import {
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three'

/** Compile the real streamed fragment closure, including injected cloud functions and logarithmic depth. */
export function checkBoulders() {
  let checks = 0
  for (const logarithmicDepthBuffer of [false, true]) {
    const renderer = new WebGLRenderer({ logarithmicDepthBuffer })
    renderer.setSize(8, 8)
    renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
      throw new Error(`Boulder shader: ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`)
    }
    const camera = new PerspectiveCamera(50, 1, 0.01, 100),
      scene = new Scene()
    const parent = new TerrainMaterial(Actor.find(8)!)
    const material = new TerrainBoulderMaterial(parent),
      contact = createBoulderContactMaterial()
    const rock = createBoulderGeometry(0),
      plane = new PlaneGeometry(2, 2)
    try {
      for (const geometry of [rock, plane])
        geometry.setAttribute('boulderState', new InstancedBufferAttribute(new Float32Array([1, 1]), 2))
      const mesh = new InstancedMesh(rock, material, 1)
      mesh.setMatrixAt(
        0,
        new Matrix4()
          .makeRotationX(0.4)
          .scale(new Vector3(1, 0.7, 1.2))
          .setPosition(0, 0, -4)
      )
      mesh.frustumCulled = false
      scene.add(mesh)
      for (const detail of [false, true]) {
        if (detail) parent.defines.USE_TERRAIN_DETAIL = true
        else delete parent.defines.USE_TERRAIN_DETAIL
        material.sync(parent)
        renderer.render(scene, camera)
        checks++
      }
      scene.remove(mesh)
      const shadow = new InstancedMesh(plane, contact, 1)
      shadow.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, -3))
      shadow.frustumCulled = false
      scene.add(shadow)
      renderer.render(scene, camera)
      checks++
      if (renderer.getContext().getError() !== 0) throw new Error('Boulder GL error')
      mesh.dispose()
      shadow.dispose()
    } finally {
      rock.dispose()
      plane.dispose()
      material.dispose()
      contact.dispose()
      parent.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    }
  }
  return { checks }
}
