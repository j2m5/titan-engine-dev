import {
  Camera,
  HalfFloatType,
  LinearFilter,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Texture,
  Vector3,
  WebGLRenderTarget
} from 'three'
import { threeJS } from '@/core/graphic/ThreeJS'
import { IMPOSTOR_FRAME_FILL } from '@/core/renderables/Nebula/volume/lod'

/**
 * Bakes the raymarched volume into a render target from the current view direction,
 * so the far-LOD billboard can display it cheaply. Self-contained: owns its own RT
 * and bake camera, renders the volume standalone (no scene/postprocessing changes).
 * Rebakes only when the view direction changed past a threshold (the form is static).
 */
class ImpostorBaker {
  private readonly target: WebGLRenderTarget
  private readonly bakeCamera: PerspectiveCamera
  private readonly viewDir = new Vector3()
  private readonly lastDir = new Vector3(0, 0, 1)
  private baked = false

  private static readonly BAKE_FOV = 45

  public constructor(resolution: number) {
    // HalfFloat so the volume's HDR (>1) survives into the billboard and blooms
    // consistently with the live raymarch.
    this.target = new WebGLRenderTarget(resolution, resolution, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false
    })
    this.bakeCamera = new PerspectiveCamera(ImpostorBaker.BAKE_FOV, 1, 0.01, 100)
  }

  public get texture(): Texture {
    return this.target.texture
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
  public bake(volume: Object3D, camera: Camera, center: Vector3, radius: number): Texture {
    this.viewDir.subVectors(camera.position, center)
    const dist = this.viewDir.length() || 1
    this.viewDir.divideScalar(dist)

    // place the bake camera so the sphere fills ~80% of the square frame
    const halfFov = MathUtils.degToRad(ImpostorBaker.BAKE_FOV) * 0.5
    const camDist = radius / Math.tan(halfFov) / IMPOSTOR_FRAME_FILL
    this.bakeCamera.position.copy(center).addScaledVector(this.viewDir, camDist)
    this.bakeCamera.up.copy(camera.up)
    this.bakeCamera.lookAt(center)
    this.bakeCamera.near = Math.max(0.001, camDist - radius * 2)
    this.bakeCamera.far = camDist + radius * 2
    this.bakeCamera.updateProjectionMatrix()

    const renderer = threeJS.renderer
    const prevTarget = renderer.getRenderTarget()
    const prevAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(this.target)
    renderer.setClearAlpha(0)
    renderer.clear(true, true, false)
    renderer.render(volume, this.bakeCamera)
    renderer.setRenderTarget(prevTarget)
    renderer.setClearAlpha(prevAlpha)

    this.lastDir.copy(this.viewDir)
    this.baked = true
    return this.target.texture
  }

  public dispose(): void {
    this.target.dispose()
  }
}

export { ImpostorBaker }
