import { CloudShape, CloudShapeDetail } from '@takram/three-clouds'
import { Data3DTexture, NearestFilter, RedFormat, RepeatWrapping, type BufferGeometry, type Mesh } from 'three'
import { appendProgramCacheKey } from '@/core/graphic/effects/atmosphere/shaderCompilationScope'

/** Pinned 0.7.6 allocates one private plane per procedural texture, but omits it from dispose(). */
function ownedMesh(texture: CloudShape | CloudShapeDetail, programCacheKey?: string): Mesh<BufferGeometry> {
  const mesh = (texture as unknown as { mesh?: Mesh }).mesh
  if (!mesh?.isMesh || !mesh.geometry?.isBufferGeometry || typeof mesh.geometry.dispose !== 'function')
    throw new Error('Unsupported pinned cloud procedural texture: expected instance-owned mesh.geometry')
  if (Array.isArray(mesh.material)) throw new Error('Unsupported pinned cloud procedural texture material layout')
  appendProgramCacheKey(mesh.material, programCacheKey)
  return mesh
}

/** Local procedural assets: no CDN, storage bucket, or Earth weather-map seams. */
export function createCloudTextures(programCacheKey?: string) {
  const releases: Array<() => void> = []
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const errors: unknown[] = []
    for (const release of releases) {
      try {
        release()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw errors[0]
  }
  try {
    const shape = new CloudShape()
    releases.push(() => shape.dispose())
    const shapeMesh = ownedMesh(shape, programCacheKey)
    const shapeGeometry = shapeMesh.geometry
    releases.push(() => shapeGeometry.dispose())
    const detail = new CloudShapeDetail()
    releases.push(() => detail.dispose())
    const detailMesh = ownedMesh(detail, programCacheKey)
    const detailGeometry = detailMesh.geometry
    if (detailGeometry === shapeGeometry)
      throw new Error('Unsupported pinned cloud procedural texture: geometry must be instance-owned, not shared')
    releases.push(() => detailGeometry.dispose())

    // Deterministic white-noise jitter for the experiment, not upstream's NVIDIA STBN asset.
    // The renderer accepts arbitrary noise texture dimensions via textureSize().
    const noiseBytes = new Uint8Array(64 * 64 * 64)
    let seed = 0x4a757069
    for (let i = 0; i < noiseBytes.length; i++) {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      noiseBytes[i] = seed & 255
    }
    const noise = new Data3DTexture(noiseBytes, 64, 64, 64)
    releases.push(() => noise.dispose())
    noise.format = RedFormat
    noise.minFilter = noise.magFilter = NearestFilter
    noise.wrapS = noise.wrapT = noise.wrapR = RepeatWrapping
    noise.needsUpdate = true

    return {
      shape,
      detail,
      noise,
      warmupMeshes: [shapeMesh, detailMesh],
      dispose
    }
  } catch (error) {
    try {
      dispose()
    } catch (cleanupError) {
      throw new Error(`Cloud noise creation failed: ${String(error)}; cleanup failed: ${String(cleanupError)}`)
    }
    throw error
  }
}
