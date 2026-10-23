import { Color, type PerspectiveCamera, type Texture, Vector2, Vector4, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import { isScaledDepthVolume, isTemporalDepthVolume, type DepthVolume } from './DepthVolume'
import { createVolumeTarget, DepthVolumeHistory, temporalWeight } from './DepthVolumeHistory'
import { DepthVolumeReconstructionRenderer } from './DepthVolumeReconstructionRenderer'

function scaleOf(volume: DepthVolume): number {
  if (!isScaledDepthVolume(volume) || !Number.isFinite(volume.resolutionScale)) return 1
  return Math.max(0.25, Math.min(1, volume.resolutionScale))
}

/** One transient HDR target per pass, shared across all scaled volumes in draw order. */
export class DepthVolumeResolutionRenderer {
  private target: WebGLRenderTarget | null = null
  private readonly lowSize = new Vector2()
  private readonly viewport = new Vector4()
  private readonly clearColor = new Color()
  private readonly history: DepthVolumeHistory
  private readonly reconstruction = new DepthVolumeReconstructionRenderer()
  private renderer: WebGLRenderer | null = null
  private readonly resetHistory = () => this.history.clear()

  public constructor(maxHistoryBytes?: number) { this.history = new DepthVolumeHistory(maxHistoryBytes) }

  public prepare(volumes: readonly DepthVolume[], resolution: Vector2): void {
    this.history.prepare(volumes, resolution)
    this.reconstruction.prepare(volumes)
    let largestScale = 0
    let count = 1
    for (const volume of volumes) {
      const scale = scaleOf(volume)
      const temporal = temporalWeight(volume) > 0
      if (scale < 1 || temporal) largestScale = Math.max(largestScale, scale)
      if (temporal) count = 2
    }
    if (largestScale === 0) return
    const width = Math.max(1, Math.ceil(resolution.x * largestScale))
    const height = Math.max(1, Math.ceil(resolution.y * largestScale))
    if (this.target && this.target.textures.length !== count) { this.target.dispose(); this.target = null }
    if (this.target) this.target.setSize(width, height)
    else {
      this.target = createVolumeTarget(width, height, count)
      this.target.texture.name = 'DepthVolume reduced HDR'
    }
  }

  public render(
    renderer: WebGLRenderer, output: WebGLRenderTarget | null, camera: PerspectiveCamera,
    volume: DepthVolume, sceneDepth: Texture, resolution: Vector2, logFarFactor: number
  ): void {
    const scale = scaleOf(volume), low = this.target
    const temporal = isTemporalDepthVolume(volume) && temporalWeight(volume) > 0 ? volume : null
    if ((scale === 1 && !temporal) || !low || !isScaledDepthVolume(volume)) {
      renderer.render(volume, camera)
      return
    }
    // Screen UVs assume a complete viewport; retain the native path for cropped
    // targets, split views, or custom callers with a different viewport contract.
    renderer.getCurrentViewport(this.viewport)
    if (this.viewport.x !== 0 || this.viewport.y !== 0 || this.viewport.z !== resolution.x || this.viewport.w !== resolution.y) {
      this.history.forget(volume)
      renderer.render(volume, camera)
      return
    }
    if (temporal) this.trackRenderer(renderer)
    this.lowSize.set(Math.max(1, Math.ceil(resolution.x * scale)), Math.max(1, Math.ceil(resolution.y * scale)))
    const frame = temporal ? this.history.begin(temporal, camera, this.lowSize) : null
    if (scale === 1 && !frame) { renderer.render(volume, camera); return }
    const previousTarget = renderer.getRenderTarget()
    const previousLayer = renderer.getActiveCubeFace(), previousMip = renderer.getActiveMipmapLevel()
    const previousAutoClear = renderer.autoClear, previousAlpha = renderer.getClearAlpha()
    renderer.getClearColor(this.clearColor)
    try {
      // A disabled branch is not enough: WebGL rejects an attached texture even
      // when its sampler is only used conditionally. Remove the sampler binding.
      volume.unbindLowResolution()
      if (frame) temporal!.bindTemporalCapture(frame.jitter)
      volume.bindSceneDepth(sceneDepth, this.lowSize, logFarFactor)
      low.viewport.set(0, 0, this.lowSize.x, this.lowSize.y)
      renderer.autoClear = false
      renderer.setRenderTarget(low)
      renderer.setClearColor(0, 0)
      renderer.clear(true, false, false)
      renderer.render(volume, camera)

      temporal?.unbindTemporalCapture()
      const image = frame ? this.history.resolve(renderer, low, frame) : low.texture
      renderer.setRenderTarget(output)
      volume.bindSceneDepth(sceneDepth, resolution, logFarFactor)
      volume.bindLowResolution(image, this.lowSize)
      if (!this.reconstruction.render(renderer, output, camera, volume, resolution)) renderer.render(volume, camera)
      if (frame) this.history.commit(frame)
    } catch (error) {
      if (frame) this.history.invalidate(frame)
      throw error
    } finally {
      temporal?.unbindTemporalCapture()
      volume.unbindLowResolution()
      renderer.setRenderTarget(previousTarget, previousLayer, previousMip)
      renderer.setClearColor(this.clearColor, previousAlpha)
      renderer.autoClear = previousAutoClear
    }
  }

  public dispose(): void {
    this.detachRenderer()
    this.history.dispose()
    this.reconstruction.dispose()
    this.target?.dispose()
    this.target = null
  }

  private trackRenderer(renderer: WebGLRenderer): void {
    if (this.renderer === renderer) return
    this.detachRenderer()
    this.history.clear()
    this.renderer = renderer
    renderer.domElement?.addEventListener?.('webglcontextlost', this.resetHistory)
    renderer.domElement?.addEventListener?.('webglcontextrestored', this.resetHistory)
  }

  private detachRenderer(): void {
    this.renderer?.domElement?.removeEventListener?.('webglcontextlost', this.resetHistory)
    this.renderer?.domElement?.removeEventListener?.('webglcontextrestored', this.resetHistory)
    this.renderer = null
  }
}
