import { BoxGeometry, Color, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, Matrix4, PerspectiveCamera,
  PlaneGeometry, Scene, Vector4, WebGLRenderTarget, type WebGLRenderer } from 'three'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { BillboardAsteroidMaterial } from '../BillboardAsteroidMaterial'
import { checkedImpostorGpu } from './impostorGpuCheck'
import { forgetImpostorContext, rememberImpostorContext } from './impostorContext'

export interface ImpostorMaterialVariant { ice: boolean; cascade: boolean; lightTint: boolean }
/** VBO двух малых мешей и target 4x4, с запасом на выравнивание. */
export const IMPOSTOR_WARMUP_BYTES = 4096

export function createImpostorWarmup(renderer: WebGLRenderer, variant: ImpostorMaterialVariant): { run(): Promise<void>; dispose(): void; invalidateGpu(): void } {
  const near = new InstancedAsteroidMaterial(undefined, undefined, variant.ice)
  const far = new BillboardAsteroidMaterial(undefined, variant.cascade, variant.ice, true)
  if (variant.lightTint) {
    near.defines = { USE_LIGHT_TINT: '1', ...near.defines }
    far.defines = { USE_LIGHT_TINT: '1', ...far.defines }
  }
  const box = new BoxGeometry(), plane = new PlaneGeometry(2.5, 2.5), scene = new Scene()
  box.setAttribute('surfaceData', new Float32BufferAttribute(new Float32Array(box.getAttribute('position').count * 4), 4))
  const meshes = [new InstancedMesh(box, near, 1), new InstancedMesh(plane, far, 1)]
  for (const mesh of meshes) {
    for (const [name, size, value] of [['instanceFade', 1, 1], ['instanceOrigin', 3, 0], ['instanceMaxDistance', 1, 100],
      ['instanceArchetype', 1, 0], ['instanceDetailEnd', 1, 10], ['instanceDetailMix', 1, 1]] as const) {
      mesh.geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(size).fill(value), size))
    }
    mesh.frustumCulled = false
    mesh.setMatrixAt(0, new Matrix4())
    scene.add(mesh)
  }
  const target = new WebGLRenderTarget(4, 4), camera = new PerspectiveCamera(45, 1, .1, 100)
  rememberImpostorContext(...meshes, box, plane, near, far, target, target.texture)
  camera.position.z = 4
  camera.updateMatrixWorld(true)
  let disposed = false
  return {
    invalidateGpu: () => forgetImpostorContext(...meshes, box, plane, near, far, target, target.texture),
    run: async () => {
      const saved = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
        color: renderer.getClearColor(new Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear,
        viewport: renderer.getViewport(new Vector4()), scissor: renderer.getScissor(new Vector4()), scissorTest: renderer.getScissorTest() }
      try {
        checkedImpostorGpu(renderer, () => {
          renderer.setRenderTarget(target)
          renderer.setScissorTest(false)
          renderer.setClearColor(0, 0)
          renderer.autoClear = true
          for (const mesh of meshes) {
            if (renderer.getContext().isContextLost()) throw new Error('Контекст WebGL потерян')
            for (const other of meshes) other.visible = other === mesh
            renderer.render(scene, camera)
          }
        })
      } finally {
        if (!renderer.getContext().isContextLost()) {
          renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest)
          renderer.setRenderTarget(saved.target, saved.face, saved.mip)
          renderer.setClearColor(saved.color, saved.alpha)
        }
        renderer.autoClear = saved.autoClear
      }
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const mesh of meshes) mesh.dispose()
      near.dispose(); far.dispose(); box.dispose(); plane.dispose(); target.dispose()
    }
  }
}
