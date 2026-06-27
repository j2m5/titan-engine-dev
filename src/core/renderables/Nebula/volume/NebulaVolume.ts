import { BackSide, BoxGeometry, Camera, Mesh, Scene, Vector3, WebGLRenderer } from 'three'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'

/**
 * Bounding-proxy mesh for the volumetric raymarch. The geometry is a unit cube
 * in [-1,1]; the container scales it to physical size. BackSide so the volume
 * still renders when the camera is inside it.
 */
class NebulaVolume extends Mesh {
  declare public material: NebulaRaymarchMaterial

  private static readonly _cameraWorld = new Vector3()
  private static readonly _starLocal = new Vector3()

  /** Star world position (lighting), or null. Transformed to local space per frame. */
  private readonly starWorld: Vector3 | null

  public constructor(params: NebulaParams) {
    super(new BoxGeometry(2, 2, 2), new NebulaRaymarchMaterial(params))
    this.material.side = BackSide
    this.frustumCulled = false
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
      this.material.updateMaterial()
    }
  }

  public updateObject(_delta?: number): void {
    // Intentionally empty: per-frame uniform updates live in onBeforeRender.
  }
}

export { NebulaVolume }
