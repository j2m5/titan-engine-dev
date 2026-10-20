import {
  Box3,
  Camera,
  Color,
  HalfFloatType,
  LinearFilter,
  MathUtils,
  Matrix4,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Sphere,
  Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { IMPOSTOR_FRAME_FILL } from '@/core/renderables/Nebula/volume/lod'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'

/**
 * Bakes the raymarched volume into a render target from the current view direction,
 * so the far-LOD billboard can display it cheaply. Self-contained: owns its own RT
 * and bake camera, renders the volume standalone (no scene/postprocessing changes).
 * Rebakes only when the view direction changed past a threshold (the form is static).
 */
class ImpostorBaker {
  private target: WebGLRenderTarget
  private staging: WebGLRenderTarget
  private readonly bakeCamera: PerspectiveCamera
  private readonly viewDir = new Vector3()
  private readonly lastDir = new Vector3(0, 0, 1)
  private baked = false
  private readonly completedOrientation = new Quaternion()
  private readonly pendingDirection = new Vector3()
  private readonly volumeWorld = new Matrix4()
  private readonly proxyBounds = new Box3()
  private readonly proxySphere = new Sphere()
  private pendingVolume: Object3D | null = null
  private nextTile = 0
  private tileSize = 128

  private static readonly BAKE_FOV = 45

  public constructor(
    private readonly renderer: WebGLRenderer,
    resolution: number
  ) {
    // HalfFloat so the volume's HDR (>1) survives into the billboard and blooms
    // consistently with the live raymarch.
    this.target = new WebGLRenderTarget(resolution, resolution, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false
    })
    this.staging = this.target.clone()
    this.bakeCamera = new PerspectiveCamera(ImpostorBaker.BAKE_FOV, 1, 0.01, 100)
    // The volume sits on the DepthVolumePass layer, invisible to a default camera;
    // the bake renders it standalone and must see that layer. No scene depth is
    // bound here, so the marcher runs uncut (uSceneDepthEnabled = 0).
    this.bakeCamera.layers.enable(DEPTH_VOLUME_LAYER)
  }

  public get texture(): Texture {
    return this.target.texture
  }

  /** World orientation of the last bake's camera: the billboard must match it */
  public get orientation(): Quaternion {
    return this.completedOrientation
  }

  public get pending(): boolean { return this.pendingVolume !== null }

  /** Force a rebake on the next shouldRebake (the RT content was lost with the context). */
  public invalidate(): void {
    this.baked = false
    this.pendingVolume = null
  }

  /** True if no bake yet, or the view direction has rotated past the threshold. */
  public shouldRebake(center: Vector3, cameraPosition: Vector3, thresholdRad: number): boolean {
    if (!this.baked) return true
    this.viewDir.subVectors(cameraPosition, center)
    if (this.viewDir.lengthSq() < 1e-12) return false
    this.viewDir.normalize()
    return this.lastDir.angleTo(this.viewDir) > thresholdRad
  }

  /**
   * Render `volume` alone into the RT, framing a sphere of `radius` at `center` from
   * the current camera direction. `volume` keeps its place in the scene graph; its
   * world matrix is recomputed by the standalone render, so placement stays correct.
   */
  public begin(volume: Object3D, camera: Camera, center: Vector3, radius: number): void {
    this.pendingVolume = null
    camera.getWorldPosition(this.viewDir).sub(center)
    const dist = this.viewDir.length() || 1
    this.viewDir.divideScalar(dist)

    // place the bake camera so the sphere fills ~80% of the square frame
    const halfFov = MathUtils.degToRad(ImpostorBaker.BAKE_FOV) * 0.5
    const camDist = radius / Math.tan(halfFov) / IMPOSTOR_FRAME_FILL
    this.bakeCamera.position.copy(center).addScaledVector(this.viewDir, camDist)
    this.bakeCamera.up.copy(camera.up)
    this.bakeCamera.lookAt(center)
    // BackSide rasterisation needs the EXIT face, even where the density ends
    // earlier. Frame the density, but clip against the actual (larger) proxy.
    volume.updateWorldMatrix(true, false)
    this.proxyBounds.setFromObject(volume).getBoundingSphere(this.proxySphere)
    const clipRadius = Math.max(radius * 2, this.proxySphere.radius + this.proxySphere.center.distanceTo(center))
    this.bakeCamera.near = Math.max(0.001, camDist - clipRadius)
    this.bakeCamera.far = camDist + clipRadius
    this.bakeCamera.updateProjectionMatrix()
    this.pendingDirection.copy(this.viewDir)
    this.volumeWorld.copy(volume.matrixWorld)
    this.pendingVolume = volume
    this.nextTile = 0
    this.tileSize = 128
  }

  /** Render a single scissored tile into the unpublished back buffer. */
  public step(): boolean {
    const volume = this.pendingVolume
    if (!volume) return true
    const columns = Math.ceil(this.staging.width / this.tileSize)
    const rows = Math.ceil(this.staging.height / this.tileSize)
    const x = (this.nextTile % columns) * this.tileSize
    const y = Math.floor(this.nextTile / columns) * this.tileSize
    this.staging.scissor.set(x, y, Math.min(this.tileSize, this.staging.width - x), Math.min(this.tileSize, this.staging.height - y))
    this.staging.scissorTest = true
    const renderer = this.renderer
    const prevTarget = renderer.getRenderTarget()
    const prevLayer = renderer.getActiveCubeFace()
    const prevMip = renderer.getActiveMipmapLevel()
    const prevColor = renderer.getClearColor(new Color())
    const prevAlpha = renderer.getClearAlpha()
    const prevWorld = volume.matrixWorld.clone()
    const prevAutoUpdate = volume.matrixWorldAutoUpdate
    const prevNeedsUpdate = volume.matrixWorldNeedsUpdate
    try {
      volume.matrixWorld.copy(this.volumeWorld)
      volume.matrixWorldAutoUpdate = false
      renderer.setRenderTarget(this.staging)
      // The RT stores premultiplied colour, regardless of canvas alpha settings.
      renderer.setClearColor(0, 0)
      renderer.clear(true, true, false)
      renderer.render(volume, this.bakeCamera)
    } catch (error) {
      this.pendingVolume = null
      throw error
    } finally {
      volume.matrixWorld.copy(prevWorld)
      volume.matrixWorldAutoUpdate = prevAutoUpdate
      volume.matrixWorldNeedsUpdate = prevNeedsUpdate
      renderer.setRenderTarget(prevTarget, prevLayer, prevMip)
      renderer.setClearColor(prevColor, prevAlpha)
    }

    this.nextTile++
    if (this.nextTile === columns * rows) {
      const previous = this.target
      this.target = this.staging
      this.staging = previous
      this.target.scissorTest = false
      this.completedOrientation.copy(this.bakeCamera.quaternion)
      this.lastDir.copy(this.pendingDirection)
      this.baked = true
      this.pendingVolume = null
    }
    return !this.pending
  }

  /** Offline convenience: one full-target render, preserving the historical API. */
  public bake(volume: Object3D, camera: Camera, center: Vector3, radius: number): Texture {
    this.begin(volume, camera, center, radius)
    this.tileSize = Math.max(this.staging.width, this.staging.height)
    this.step()
    return this.target.texture
  }

  public dispose(): void {
    this.pendingVolume = null
    this.target.dispose()
    this.staging.dispose()
  }
}

export { ImpostorBaker }
