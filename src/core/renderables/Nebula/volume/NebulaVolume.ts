import { BackSide, BoxGeometry, Camera, Matrix4, Mesh, Object3D, PerspectiveCamera, Scene, Texture, Vector2, Vector3, WebGLCoordinateSystem, WebGLRenderer, type BufferAttribute } from 'three'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'
import { UpdateContext } from '@/core/UpdateContext'
import { DEPTH_VOLUME_LAYER, type TemporalDepthVolume } from '@/core/graphic/passes/DepthVolume'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import type { Disposable } from '@/core/lifecycle/Disposable'
import { IMPOSTOR_FRAME_FILL } from './lod'

/**
 * Raster proxy for the density cube [-1,1] and the oriented impostor plane.
 * The larger [-2,2] geometry encloses both representations; the shader still
 * integrates density only in [-1,1]. BackSide supports cameras inside the proxy.
 *
 * Lives in the scene graph (the main pass updates its matrices) but is drawn by
 * DepthVolumePass: it sits on DEPTH_VOLUME_LAYER and is listed in the registry, so
 * the marcher can cut its ray at the scene depth. Without a registry (tests,
 * standalone scenes) the volume exists in the graph but no pass draws it.
 */
class NebulaVolume extends Mesh implements TemporalDepthVolume, Disposable {
  public readonly supportsDepthVolumeBatch = true
  declare public material: NebulaRaymarchMaterial
  public readonly supportsStencilReconstruction = true

  /** Bounds actual density + billboard, rather than the larger raster proxy. */
  public readonly boundingRadius = Math.max(Math.sqrt(3), Math.SQRT2 / IMPOSTOR_FRAME_FILL)

  private static readonly _cameraWorld = new Vector3()
  private static readonly _starLocal = new Vector3()
  private readonly inverseWorld = new Matrix4()
  private readonly reconstructionMatrix = new Matrix4()
  private readonly reconstructionPoint = new Vector3()
  private readonly proxyGeometry = this.geometry
  private readonly proxyPosition = this.geometry.getAttribute('position') as BufferAttribute
  private readonly proxyIndex = this.geometry.index!
  private readonly proxyPositions = this.proxyPosition.array.slice()
  private readonly proxyIndices = this.proxyIndex.array.slice()
  private impostorFrame: Object3D | null = null

  /** Star world position (lighting), or null. Transformed to local space per frame. */
  private readonly starWorld: Vector3 | null

  /** Cached from updateObject; consumed in onBeforeRender (see comment below). */
  private _elapsed: number = 0

  private registry: DepthVolumeRegistry | null
  private readonly quality: NebulaParams['quality']

  public constructor(params: NebulaParams, registry: DepthVolumeRegistry | null = null) {
    super(new BoxGeometry(4, 4, 4), new NebulaRaymarchMaterial(params))
    this.material.side = BackSide
    this.frustumCulled = false
    this.layers.set(DEPTH_VOLUME_LAYER)
    this.registry = registry
    this.quality = params.quality
    this.registry?.register(this)
    this.starWorld = params.lighting.starPosition ? params.lighting.starPosition.clone() : null

    // Camera/matrix-dependent uniforms are refreshed in onBeforeRender, not in
    // updateObject: three calls onBeforeRender at render time when matrixWorld
    // and the camera are current for THIS frame. SceneManager.update runs after
    // the render, so updating there lags one frame and makes the volume swim
    // ("parasitic parallax") under camera translation — same reasoning as BlackHole.
    this.onBeforeRender = (_renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
      const u = this.material.uniforms
      this.inverseWorld.copy(this.matrixWorld).invert()
      camera.getWorldPosition(NebulaVolume._cameraWorld)
      // Cancel large world translations in CPU double precision, before GLSL's
      // float32 uniforms lose the small camera-to-volume displacement.
      u.uCameraLocal.value.copy(NebulaVolume._cameraWorld).applyMatrix4(this.inverseWorld)
      if (this.impostorFrame) {
        this.impostorFrame.updateWorldMatrix(true, false)
        u.uLocalToImpostor.value.copy(this.impostorFrame.matrixWorld).invert().multiply(this.matrixWorld)
      }
      if (this.starWorld) {
        // world star position -> proxy-local space (same transform the marcher uses)
        u.uStarLocal.value.copy(NebulaVolume._starLocal.copy(this.starWorld).applyMatrix4(this.inverseWorld))
      }
      this.material.updateMaterial(this._elapsed)
    }
  }

  public setImpostor(texture: Texture, frame: Object3D): void {
    this.material.uniforms.uImpostorMap.value = texture
    this.impostorFrame = frame
  }

  public updateObject(ctx: UpdateContext): void {
    // Per-frame uniform updates live in onBeforeRender (see constructor comment);
    // here we only cache elapsed time, since onBeforeRender has no UpdateContext.
    this._elapsed = ctx.elapsed
  }

  /** DepthVolume contract: bound by DepthVolumePass right before its render. */
  public bindSceneDepth(sceneDepth: Texture, resolution: Vector2, logFarFactor: number): void {
    const u = this.material.uniforms
    u.uSceneDepth.value = sceneDepth
    u.uResolution.value.copy(resolution)
    u.uLogFarFactor.value = logFarFactor
    u.uSceneDepthEnabled.value = 1
  }

  /** Unbound right after: the impostor bake renders this volume without a scene depth. */
  public unbindSceneDepth(): void {
    this.material.uniforms.uSceneDepthEnabled.value = 0
  }

  /** Far impostors are already cheap texture draws; keep them at native resolution. */
  public get resolutionScale(): number {
    return this.material.uniforms.uLodBlend.value <= 0 ? 1 : this.quality.resolutionScale
  }

  /** A convex box encloses all viewport rays when its near-plane rectangle is
   * strictly inside and the entire box is before the far plane. Then composition
   * covers every MSAA sample; partial proxy edges keep the original draw. */
  public coversReconstructionViewport(camera: Camera): boolean {
    if (!(camera instanceof PerspectiveCamera) || camera.coordinateSystem !== WebGLCoordinateSystem || camera.reversedDepth ||
      !Number.isFinite(camera.far) || camera.far <= camera.near || this.geometry !== this.proxyGeometry ||
      this.geometry.getAttribute('position') !== this.proxyPosition || this.geometry.index !== this.proxyIndex ||
      this.proxyPosition.version !== 0 || this.proxyIndex.version !== 0 || this.geometry.drawRange.start !== 0 ||
      this.geometry.drawRange.count < this.proxyIndex.count) return false
    // setXYZ/setX before the first upload need not increment attribute.version.
    // Certify the actual small box, not only its attribute identities/versions.
    if (this.proxyPosition.itemSize !== 3 || this.proxyIndex.itemSize !== 1 ||
      this.proxyPosition.count !== this.proxyPositions.length / 3 || this.proxyIndex.count !== this.proxyIndices.length ||
      this.proxyPosition.array.length !== this.proxyPositions.length || this.proxyIndex.array.length !== this.proxyIndices.length ||
      this.proxyPosition.array.constructor !== this.proxyPositions.constructor || this.proxyIndex.array.constructor !== this.proxyIndices.constructor) return false
    for (let i = 0; i < this.proxyPositions.length; i++) if (this.proxyPosition.array[i] !== this.proxyPositions[i]) return false
    for (let i = 0; i < this.proxyIndices.length; i++) if (this.proxyIndex.array[i] !== this.proxyIndices[i]) return false
    this.updateWorldMatrix(true, false)
    camera.updateWorldMatrix(true, false)
    const determinant = this.matrixWorld.determinant()
    if (!Number.isFinite(determinant) || determinant === 0 || camera.projectionMatrix.determinant() === 0) return false
    const matrix = this.reconstructionMatrix, point = this.reconstructionPoint
    matrix.copy(this.matrixWorld).invert().multiply(camera.matrixWorld).multiply(camera.projectionMatrixInverse)
    for (let i = 0; i < 4; i++) {
      point.set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, -1).applyMatrix4(matrix)
      // A local margin rejects uncertain boundary coverage after float32 rasterization.
      if (![point.x, point.y, point.z].every(value => Number.isFinite(value) && Math.abs(value) < 2 - 1e-5)) return false
    }
    matrix.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld)
    for (let i = 0; i < 8; i++) {
      point.set(i & 1 ? 2 : -2, i & 2 ? 2 : -2, i & 4 ? 2 : -2).applyMatrix4(matrix)
      if (!Number.isFinite(point.z) || -point.z >= camera.far * (1 - 1e-6)) return false
    }
    return true
  }

  public bindLowResolution(texture: Texture, size: Vector2): void {
    const u = this.material.uniforms
    u.uLowResolutionMap.value = texture
    u.uLowResolutionSize.value.copy(size)
    u.uLowResolutionEnabled.value = 1
  }

  public unbindLowResolution(): void {
    this.material.uniforms.uLowResolutionEnabled.value = 0
    this.material.uniforms.uLowResolutionMap.value = null
  }

  public get temporalBlend(): number {
    return this.material.uniforms.uLodBlend.value >= 1 ? this.quality.temporalBlend : 0
  }

  public get temporalRevision(): number {
    return this.material.temporalRevision + this.material.version
  }

  public bindTemporalCapture(jitter: number): void {
    this.material.uniforms.uTemporalCapture.value = 1
    this.material.uniforms.uTemporalJitter.value = jitter
  }

  public unbindTemporalCapture(): void {
    this.material.uniforms.uTemporalCapture.value = 0
    this.material.uniforms.uTemporalJitter.value = 0
  }

  /** Leaves the pass registry. Idempotent; geometry/material are owned by the container. */
  public dispose(): void {
    this.registry?.unregister(this)
    this.registry = null
  }
}

export { NebulaVolume }
