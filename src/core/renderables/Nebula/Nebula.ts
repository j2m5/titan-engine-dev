import { Vector2, Vector3, Object3D, PerspectiveCamera, WebGLRenderer } from 'three'
import { DeepPartial, NebulaParams, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { ImpostorBaker } from '@/core/renderables/Nebula/volume/ImpostorBaker'
import { NebulaDensityBaker } from '@/core/renderables/Nebula/volume/NebulaDensityBaker'
import { NebulaBakeQueue } from '@/core/renderables/Nebula/volume/NebulaBakeQueue'
import { IMPOSTOR_FRAME_FILL, selectLOD } from '@/core/renderables/Nebula/volume/lod'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'

const REBAKE_ANGLE = 0.15 // rad (~8.6°): rebake the impostor past this view-dir change
const IMPOSTOR_RESOLUTION = 512

/**
 * Standalone volumetric nebula: `new Nebula(renderer, params)` -> `scene.add(...)`.
 * Adaptive LOD mixes live and baked premultiplied images inside one volume draw.
 * Baking is incremental; call bakeQueue.pumpFrame() once per frame when standalone.
 * Density coordinates are scaled uniformly by size; anisotropy lives in uInvAxis.
 */
class Nebula extends Object3D {
  public readonly params: NebulaParams
  private readonly volume: NebulaVolume
  private readonly impostor = new Object3D()
  private impostorReady = false
  private baker: ImpostorBaker | null = null
  private densityBaker: NebulaDensityBaker | null = null
  private densityPending = false
  private readonly densityJob = {}
  private readonly impostorJob = {}
  private desiredBlend = 1
  private bakeFailed = false
  private disposed = false
  private readonly boundingRadius: number

  private readonly _center = new Vector3()
  private readonly _cameraWorld = new Vector3()
  private readonly _right = new Vector3()
  private readonly _edge = new Vector3()
  private readonly _ndcA = new Vector3()
  private readonly _ndcB = new Vector3()
  private readonly _viewSize = new Vector2()

  /**
   * @param depthVolumeRegistry registry of DepthVolumePass — the raymarch volume is
   * drawn by that pass (ray cut at the scene depth). null: the volume stays in the
   * graph but no pass draws it (tests, standalone scenes).
   */
  public constructor(
    private readonly renderer: WebGLRenderer,
    params: DeepPartial<NebulaParams> = {},
    depthVolumeRegistry: DepthVolumeRegistry | null = null,
    public readonly bakeQueue = new NebulaBakeQueue()
  ) {
    super()
    this.params = mergeNebulaParams(params)
    this.name = 'Nebula'
    this.boundingRadius = this.params.size

    this.volume = new NebulaVolume(this.params, depthVolumeRegistry)
    this.add(this.volume)
    // size is the density cube half-extent (the raster proxy also encloses the billboard).
    this.volume.scale.multiplyScalar(this.params.size)

    this.impostor.name = 'NebulaImpostorFrame'
    this.add(this.impostor)
    // billboard quad spans the bake frame so the baked sphere maps 1:1 onto it.
    this.impostor.scale.setScalar(this.params.size / IMPOSTOR_FRAME_FILL)

    this.ensureBakers()

    // optional call: renderer stubs in tests expose a domElement without addEventListener
    this.renderer.domElement?.addEventListener?.('webglcontextrestored', this.onContextRestored)
  }

  /**
   * A lost context wipes render-target contents: three recreates them empty, so the
   * baked density field and the impostor would come back blank. three's own
   * listener was registered first (WebGLRenderer constructor) — the context is ready.
   */
  private readonly onContextRestored = (): void => {
    this.bakeQueue.cancel(this.densityJob)
    this.bakeQueue.cancel(this.impostorJob)
    this.bakeFailed = false
    this.baker?.invalidate()
    this.impostorReady = false
    this.volume.material.setBakedDensityTexture(null)
    this.volume.material.uniforms.uLodBlend.value = 1
    if (this.baker) this.queueDensity()
    else this.ensureBakers()
  }

  /** Reserve the maximum resident texture footprint before creating any targets. */
  private ensureBakers(): void {
    if (this.baker || this.bakeFailed || this.disposed) return
    const densityBytes = this.params.quality.bake3DTexture ? this.params.quality.bakeResolution ** 3 * 2 : 0 // gas + dust RG8
    const impostorBytes = 2 * IMPOSTOR_RESOLUTION ** 2 * 8 // front + staging RGBA16F
    if (!this.bakeQueue.reserve(this, densityBytes + impostorBytes)) return
    try {
      this.baker = new ImpostorBaker(this.renderer, IMPOSTOR_RESOLUTION)
      if (this.params.quality.bake3DTexture) {
        this.densityBaker = new NebulaDensityBaker(this.renderer, this.params.quality.bakeResolution)
      }
      this.queueDensity()
    } catch (error) {
      this.failBaking()
      throw error
    }
  }

  private queueDensity(): void {
    const baker = this.densityBaker
    this.densityPending = baker !== null
    if (!baker) return
    baker.start(this.params)
    this.bakeQueue.enqueue(this.densityJob, () => {
      try {
        if (!baker.step()) return false
        this.volume.material.setBakedDensityTexture(baker.texture)
        this.densityPending = false
        return true
      } catch (error) {
        this.failBaking()
        throw error
      }
    })
  }

  private releaseBakers(): void {
    this.bakeQueue.cancel(this.densityJob)
    this.bakeQueue.cancel(this.impostorJob)
    this.baker?.dispose()
    this.densityBaker?.dispose()
    this.baker = null
    this.densityBaker = null
    this.densityPending = false
    this.bakeQueue.release(this)
  }

  private failBaking(): void {
    this.bakeFailed = true
    this.impostorReady = false
    this.releaseBakers()
    this.volume.material.setBakedDensityTexture(null)
    this.volume.material.uniforms.uImpostorMap.value = null
    this.volume.material.uniforms.uLodBlend.value = 1
  }

  /** Select and bake the representation after camera follow and collision. */
  public updateView(camera: PerspectiveCamera): void {
    if (this.disposed) return
    // Projection runs before either renderer refreshes the camera matrices.
    camera.updateWorldMatrix(true, false)
    camera.getWorldPosition(this._cameraWorld)
    const { blend } = selectLOD(this.projectedScreenRadius(camera), this.params.quality.forceLOD)
    this.desiredBlend = blend
    this.ensureBakers()
    const baker = this.baker
    // Finish density first: every tile in an impostor must see the same field.
    if (blend < 1 && baker && !this.densityPending && !baker.pending &&
        baker.shouldRebake(this._center, this._cameraWorld, REBAKE_ANGLE)) {
      baker.begin(this.volume, camera, this._center, this.boundingRadius)
      this.bakeQueue.enqueue(this.impostorJob, () => this.stepImpostor(baker))
    }

    // Final crossfade state for the main render.
    this.volume.visible = true
    this.volume.material.uniforms.uOpacityScale.value = 1
    this.volume.material.uniforms.uLodBlend.value = this.impostorReady ? blend : 1
  }

  private stepImpostor(baker: ImpostorBaker): boolean {
    const u = this.volume.material.uniforms
    const prevVisible = this.volume.visible
    const prevOpacity = u.uOpacityScale.value
    let complete = false
    try {
      this.volume.visible = true
      u.uOpacityScale.value = 1
      u.uLodBlend.value = 1
      complete = baker.step()
      if (complete) {
        this.volume.setImpostor(baker.texture, this.impostor)
        this.impostor.quaternion.copy(baker.orientation)
        this.impostorReady = true
      }
    } catch (error) {
      this.failBaking()
      throw error
    } finally {
      this.volume.visible = prevVisible
      u.uOpacityScale.value = prevOpacity
      u.uLodBlend.value = this.impostorReady ? this.desiredBlend : 1
    }
    return complete
  }

  /** Projected pixel radius of the nebula's bounding sphere at the current camera. */
  private projectedScreenRadius(camera: PerspectiveCamera): number {
    this.getWorldPosition(this._center)
    this._right.setFromMatrixColumn(camera.matrixWorld, 0) // camera world X axis
    this._edge.copy(this._center).addScaledVector(this._right, this.boundingRadius)

    this._ndcA.copy(this._center).project(camera)
    this._ndcB.copy(this._edge).project(camera)

    this.renderer.getSize(this._viewSize)
    const dx = (this._ndcB.x - this._ndcA.x) * 0.5 * this._viewSize.x
    const dy = (this._ndcB.y - this._ndcA.y) * 0.5 * this._viewSize.y
    const px = Math.hypot(dx, dy)
    // Guard: a non-finite radius would make selectLOD return blend=NaN, and the
    // NaN-comparison visibility flags (blend>0, blend<1) would BOTH be false ->
    // the nebula vanishes entirely. Fall back to full raymarch.
    return Number.isFinite(px) ? px : Infinity
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.renderer.domElement?.removeEventListener?.('webglcontextrestored', this.onContextRestored)
    this.volume.dispose()
    this.volume.geometry.dispose()
    this.volume.material.dispose()
    this.releaseBakers()
  }
}

export { Nebula }
