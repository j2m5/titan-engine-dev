import { Material, Object3D, type BufferGeometry, type Mesh, type PerspectiveCamera, type Scene, type ShaderMaterial, type Texture, type Vector2, type WebGLRenderer } from 'three'
import { DEPTH_VOLUME_LAYER, isScaledDepthVolume, type DepthVolume } from './DepthVolume'
import { temporalWeight } from './DepthVolumeHistory'

type BatchVolume = DepthVolume & Mesh<BufferGeometry, ShaderMaterial>
const callbacks = ['onBeforeRender', 'onAfterRender'] as const

function canWrap(volume: DepthVolume, key: typeof callbacks[number]): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(volume, key)
  return descriptor ? descriptor.writable === true : Object.isExtensible(volume)
}

function isBatchVolume(volume: DepthVolume): volume is BatchVolume {
  const mesh = volume as BatchVolume
  return volume.supportsDepthVolumeBatch === true && mesh.isMesh === true &&
    mesh.children.length === 0 && mesh.visible && !mesh.frustumCulled && mesh.layers.isEnabled(DEPTH_VOLUME_LAYER) &&
    mesh.geometry?.isBufferGeometry === true && mesh.material?.isShaderMaterial === true &&
    mesh.material.visible && mesh.material.transparent && !mesh.material.depthTest && !mesh.material.depthWrite &&
    mesh.material.onBeforeRender === Material.prototype.onBeforeRender &&
    (!isScaledDepthVolume(volume) || (volume.resolutionScale === 1 && temporalWeight(volume) === 0)) &&
    callbacks.every(key => canWrap(volume, key))
}

/** End of the consecutive direct-draw run. Repeated materials need a fresh render
 * boundary so Three uploads callback-updated uniforms even without uniformsNeedUpdate. */
export function depthVolumeBatchEnd(volumes: readonly DepthVolume[], start: number): number {
  const materials = new Set<ShaderMaterial>()
  let end = start
  for (; end < volumes.length; end++) {
    const volume = volumes[end]
    if (!isBatchVolume(volume) || materials.has(volume.material)) break
    materials.add(volume.material)
  }
  return end
}

/** One render/resolve for a run already checked by depthVolumeBatchEnd. */
export function renderDepthVolumeBatch(
  renderer: WebGLRenderer, camera: PerspectiveCamera, volumes: readonly DepthVolume[], start: number, end: number,
  sceneDepth: Texture, resolution: Vector2, logFarFactor: number
): void {
  // Do not reparent live meshes or retain a render-list root that can keep removed
  // scene volumes alive. Three keys its render lists by this temporary root.
  const root = new Object3D()
  root.matrixWorldAutoUpdate = false
  const sortObjects = renderer.sortObjects
  const saved = volumes.slice(start, end).map(volume => ({
    volume,
    before: volume.onBeforeRender,
    after: volume.onAfterRender,
    descriptors: callbacks.map(key => Object.getOwnPropertyDescriptor(volume, key))
  }))
  let bound: DepthVolume | null = null
  const unbind = () => {
    const volume = bound
    bound = null
    volume?.unbindSceneDepth()
  }
  try {
    renderer.sortObjects = false
    for (const { volume, before, after } of saved) {
      // Match rendering each mesh as a root, using its existing parent matrix.
      if (volume.matrixWorldAutoUpdate) volume.updateMatrixWorld()
      root.children.push(volume)
      volume.onBeforeRender = function (...args) {
        bound = volume
        volume.bindSceneDepth(sceneDepth, resolution, logFarFactor)
        args[1] = volume as unknown as Scene
        before.apply(volume, args)
      }
      volume.onAfterRender = function (...args) {
        try {
          args[1] = volume as unknown as Scene
          after.apply(volume, args)
        } finally { unbind() }
      }
    }
    renderer.render(root, camera)
  } finally {
    try { unbind() } finally {
      renderer.sortObjects = sortObjects
      root.children.length = 0
      for (const { volume, descriptors } of saved) {
        callbacks.forEach((key, i) => {
          const descriptor = descriptors[i]
          if (descriptor) Object.defineProperty(volume, key, descriptor)
          else Reflect.deleteProperty(volume, key)
        })
      }
    }
  }
}
