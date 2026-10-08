import { Camera, Mesh, PerspectiveCamera, PlaneGeometry, Quaternion, Texture } from 'three'
import { NebulaImpostorMaterial } from '@/core/renderables/Nebula/material/NebulaImpostorMaterial'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * Camera-facing billboard quad (local [-1,1]) for the far LOD. The container scales
 * it to the nebula's bounding radius and drives crossfade opacity; this mesh only
 * owns its material and keeps the bake camera's orientation (see setOrientation).
 */
class NebulaImpostor extends Mesh {
  declare public material: NebulaImpostorMaterial

  public constructor() {
    super(new PlaneGeometry(2, 2), new NebulaImpostorMaterial(null))
    this.frustumCulled = false
    this.visible = false

    this.onBeforeRender = (_renderer, _scene, camera: Camera): void => {
      const far = (camera as PerspectiveCamera).far ?? 1e9
      this.material.uniforms.uLogDepthBufFC.value = 2.0 / Math.log2(far + 1.0)
    }
  }

  public setTexture(map: Texture): void {
    this.material.uniforms.uMap.value = map
  }

  /**
   * Orient the quad like the camera that baked its texture (set on every rebake).
   * The bake is framed with the camera's `up`, not its roll: copying the live
   * camera quaternion spun the image with the camera on Q/E. Nebula is not
   * rotated, so the bake camera's world quaternion works as the local one.
   */
  public setOrientation(orientation: Quaternion): void {
    this.quaternion.copy(orientation)
  }

  public setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity.value = opacity
  }

  public updateObject(_ctx: UpdateContext): void {
    // Orientation is set per rebake by the container; nothing per-tick here.
  }
}

export { NebulaImpostor }
