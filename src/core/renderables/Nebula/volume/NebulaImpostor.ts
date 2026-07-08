import { Camera, Mesh, PerspectiveCamera, PlaneGeometry, Texture } from 'three'
import { NebulaImpostorMaterial } from '@/core/renderables/Nebula/material/NebulaImpostorMaterial'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * Camera-facing billboard quad (local [-1,1]) for the far LOD. The container scales
 * it to the nebula's bounding radius and drives crossfade opacity; this mesh only
 * owns its material and billboards itself toward the camera each frame.
 */
class NebulaImpostor extends Mesh {
  declare public material: NebulaImpostorMaterial

  public constructor() {
    super(new PlaneGeometry(2, 2), new NebulaImpostorMaterial(null))
    this.frustumCulled = false
    this.visible = false

    // Billboard in onBeforeRender (frame-accurate, like NebulaVolume). Nebula is not
    // rotated, so copying the camera's world quaternion orients the quad to face it.
    this.onBeforeRender = (_renderer, _scene, camera: Camera): void => {
      this.quaternion.copy(camera.quaternion)
      const far = (camera as PerspectiveCamera).far ?? 1e9
      this.material.uniforms.uLogDepthBufFC.value = 2.0 / Math.log2(far + 1.0)
    }
  }

  public setTexture(map: Texture): void {
    this.material.uniforms.uMap.value = map
  }

  public setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity.value = opacity
  }

  public updateObject(ctx: UpdateContext): void {
    // Billboarding happens in onBeforeRender; nothing per-tick here.
  }
}

export { NebulaImpostor }
