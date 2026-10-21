import { LOD, PerspectiveCamera } from 'three'

/** Select visibility before descendant view updates and postprocessing passes. */
export class ViewLod extends LOD {
  public updateView(camera: PerspectiveCamera): void {
    if (!this.autoUpdate) return
    camera.updateWorldMatrix(true, false)
    this.updateWorldMatrix(true, false)
    this.update(camera)
  }
}
