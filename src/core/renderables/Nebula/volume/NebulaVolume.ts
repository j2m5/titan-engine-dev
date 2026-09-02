import { BackSide, BoxGeometry, Camera, Mesh, Scene, Texture, Vector2, Vector3, WebGLRenderer } from 'three'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'
import { UpdateContext } from '@/core/UpdateContext'
import { DEPTH_VOLUME_LAYER, type DepthVolume } from '@/core/graphic/passes/DepthVolume'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import type { Disposable } from '@/core/lifecycle/Disposable'

/**
 * Bounding-proxy mesh for the volumetric raymarch. The geometry is a unit cube
 * in [-1,1]; the container scales it to physical size. BackSide so the volume
 * still renders when the camera is inside it.
 *
 * Lives in the scene graph (the main pass updates its matrices) but is drawn by
 * DepthVolumePass: it sits on DEPTH_VOLUME_LAYER and is listed in the registry, so
 * the marcher can cut its ray at the scene depth. Without a registry (tests,
 * standalone scenes) the volume exists in the graph but no pass draws it.
 */
class NebulaVolume extends Mesh implements DepthVolume, Disposable {
  declare public material: NebulaRaymarchMaterial

  private static readonly _cameraWorld = new Vector3()
  private static readonly _starLocal = new Vector3()

  /** Star world position (lighting), or null. Transformed to local space per frame. */
  private readonly starWorld: Vector3 | null

  /** Cached from updateObject; consumed in onBeforeRender (see comment below). */
  private _elapsed: number = 0

  private registry: DepthVolumeRegistry | null

  public constructor(params: NebulaParams, registry: DepthVolumeRegistry | null = null) {
    super(new BoxGeometry(2, 2, 2), new NebulaRaymarchMaterial(params))
    this.material.side = BackSide
    this.frustumCulled = false
    this.layers.set(DEPTH_VOLUME_LAYER)
    this.registry = registry
    this.registry?.register(this)
    this.starWorld = params.lighting.starPosition ? params.lighting.starPosition.clone() : null

    // Camera/matrix-dependent uniforms are refreshed in onBeforeRender, not in
    // updateObject: three calls onBeforeRender at render time when matrixWorld
    // and the camera are current for THIS frame. SceneManager.update runs after
    // the render, so updating there lags one frame and makes the volume swim
    // ("parasitic parallax") under camera translation — same reasoning as BlackHole.
    this.onBeforeRender = (_renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
      const u = this.material.uniforms
      u.uInvModelMatrix.value.copy(this.matrixWorld).invert()
      camera.getWorldPosition(NebulaVolume._cameraWorld)
      u.uCameraWorld.value.copy(NebulaVolume._cameraWorld)
      if (this.starWorld) {
        // world star position -> proxy-local space (same transform the marcher uses)
        u.uStarLocal.value.copy(NebulaVolume._starLocal.copy(this.starWorld).applyMatrix4(u.uInvModelMatrix.value))
      }
      this.material.updateMaterial(this._elapsed)
    }
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

  /** Leaves the pass registry. Idempotent; geometry/material are owned by the container. */
  public dispose(): void {
    this.registry?.unregister(this)
    this.registry = null
  }
}

export { NebulaVolume }
