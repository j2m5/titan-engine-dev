import { HalfFloatType, Matrix4, NearestFilter, NoColorSpace, Quaternion, Vector2, Vector3, WebGLRenderTarget, type PerspectiveCamera, type Texture, type WebGLRenderer } from 'three'
import { Pass } from 'postprocessing'
import { isTemporalDepthVolume, type DepthVolume, type TemporalDepthVolume } from './DepthVolume'
import { DepthVolumeTemporalMaterial } from './DepthVolumeTemporalMaterial'

export const DEFAULT_VOLUME_HISTORY_BYTES = 64 * 1024 * 1024

export function temporalWeight(volume: DepthVolume): number {
  return isTemporalDepthVolume(volume) && Number.isFinite(volume.temporalBlend) ? Math.max(0, Math.min(0.95, volume.temporalBlend)) : 0
}

/** Both color and local position use nearest fetches, with checked interpolation in GLSL. */
export function createVolumeTarget(width: number, height: number, count = 1): WebGLRenderTarget {
  const target = new WebGLRenderTarget(width, height, {
    count, type: HalfFloatType, depthBuffer: false, stencilBuffer: false,
    minFilter: NearestFilter, magFilter: NearestFilter
  })
  for (const texture of target.textures) {
    texture.colorSpace = NoColorSpace
    texture.generateMipmaps = false
  }
  return target
}

export interface TemporalFrame {
  readonly volume: TemporalDepthVolume
  readonly size: Vector2
  read: WebGLRenderTarget
  write: WebGLRenderTarget
  readonly previousClip: Matrix4
  readonly currentClip: Matrix4
  readonly projection: Matrix4
  readonly model: Matrix4
  readonly cameraLocal: Vector3
  readonly orientation: Quaternion
  camera: PerspectiveCamera | null
  revision: number
  samples: number
  phase: number
  jitter: number
  weight: number
}

class TemporalResolvePass extends Pass {
  public readonly material = new DepthVolumeTemporalMaterial()
  public constructor() { super('DepthVolume temporal'); this.fullscreenMaterial = this.material }
  public draw(renderer: WebGLRenderer, target: WebGLRenderTarget): void {
    renderer.setRenderTarget(target)
    renderer.render(this.scene, this.camera)
  }
}

/** Histories belong to a pass and a volume; no image can leak between volumes or cameras. */
export class DepthVolumeHistory {
  private readonly records = new Map<TemporalDepthVolume, TemporalFrame>()
  private bytes = 0
  private pass: TemporalResolvePass | null = null
  private readonly localCamera = new Vector3()
  private readonly orientation = new Quaternion()
  private readonly inverse = new Matrix4()

  public constructor(private readonly maxBytes = DEFAULT_VOLUME_HISTORY_BYTES) {}

  public prepare(volumes: readonly DepthVolume[], resolution: Vector2): void {
    const active = new Set(volumes.filter(volume => temporalWeight(volume) > 0))
    for (const [volume, frame] of this.records) {
      const scale = Math.max(0.25, Math.min(1, volume.resolutionScale))
      if (!active.has(volume) || frame.size.x !== Math.ceil(resolution.x * scale) || frame.size.y !== Math.ceil(resolution.y * scale)) this.forget(volume)
    }
  }

  public forget(volume: DepthVolume): void {
    if (!isTemporalDepthVolume(volume)) return
    const frame = this.records.get(volume)
    if (!frame) return
    frame.read.dispose()
    frame.write.dispose()
    this.bytes -= frame.size.x * frame.size.y * 32
    this.records.delete(volume)
  }

  public begin(volume: TemporalDepthVolume, camera: PerspectiveCamera, size: Vector2): TemporalFrame | null {
    let frame = this.records.get(volume)
    if (!frame) {
      const bytes = size.x * size.y * 32
      if (this.bytes + bytes > this.maxBytes) return null
      frame = {
        volume, size: size.clone(), read: createVolumeTarget(size.x, size.y, 2), write: createVolumeTarget(size.x, size.y, 2),
        previousClip: new Matrix4(), currentClip: new Matrix4(), projection: new Matrix4(), model: new Matrix4(),
        cameraLocal: new Vector3(), orientation: new Quaternion(), camera: null, revision: -1,
        samples: 0, phase: 0, jitter: 0, weight: 0
      }
      this.records.set(volume, frame)
      this.bytes += bytes
    }
    camera.updateWorldMatrix(true, false)
    volume.updateWorldMatrix(true, false)
    this.inverse.copy(volume.matrixWorld).invert()
    camera.getWorldPosition(this.localCamera).applyMatrix4(this.inverse)
    camera.getWorldQuaternion(this.orientation)
    if (frame.camera !== camera || frame.revision !== volume.temporalRevision ||
        !frame.projection.equals(camera.projectionMatrix) || !frame.model.equals(volume.matrixWorld) ||
        frame.cameraLocal.distanceToSquared(this.localCamera) > 0.25 || Math.abs(frame.orientation.dot(this.orientation)) < Math.cos(Math.PI / 24)) {
      this.invalidate(frame)
    }
    frame.camera = camera
    frame.revision = volume.temporalRevision
    frame.projection.copy(camera.projectionMatrix)
    frame.model.copy(volume.matrixWorld)
    frame.cameraLocal.copy(this.localCamera)
    frame.orientation.copy(this.orientation)
    // Cancel world translations on the CPU BEFORE multiplying by projection.
    frame.currentClip.multiplyMatrices(camera.matrixWorldInverse, volume.matrixWorld).premultiply(camera.projectionMatrix)
    frame.weight = Math.min(temporalWeight(volume), frame.samples / (frame.samples + 1))
    // 16 phases of a base-two low-discrepancy sequence, beginning with static phase0.
    const phase = frame.phase
    frame.jitter = ((phase & 1) * 8 + (phase & 2) * 2 + (phase & 4) / 2 + (phase & 8) / 8) / 16
    return frame
  }

  public resolve(renderer: WebGLRenderer, current: WebGLRenderTarget, frame: TemporalFrame): Texture {
    this.pass ??= new TemporalResolvePass()
    const material = this.pass.material, u = material.uniforms
    u.currentColor.value = current.textures[0]
    u.currentPosition.value = current.textures[1]
    u.historyColor.value = frame.read.textures[0]
    u.historyPosition.value = frame.read.textures[1]
    u.previousClip.value.copy(frame.previousClip)
    u.currentClip.value.copy(frame.currentClip)
    u.imageSize.value.copy(frame.size)
    u.historyWeight.value = frame.weight
    try { this.pass.draw(renderer, frame.write); return frame.write.texture }
    finally { material.unbind() }
  }

  public commit(frame: TemporalFrame): void {
    const old = frame.read
    frame.read = frame.write
    frame.write = old
    frame.previousClip.copy(frame.currentClip)
    frame.samples = Math.min(frame.samples + 1, 32)
    frame.phase = (frame.phase + 1) % 16
  }

  public invalidate(frame: TemporalFrame): void { frame.samples = 0; frame.phase = 0 }
  public clear(): void { for (const volume of this.records.keys()) this.forget(volume) }
  public dispose(): void { this.clear(); this.pass?.dispose(); this.pass = null }
}
