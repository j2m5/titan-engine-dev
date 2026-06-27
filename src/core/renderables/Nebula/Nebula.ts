import { Vector2, Vector3, Object3D } from 'three'
import { DeepPartial, NebulaParams, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { NebulaImpostor } from '@/core/renderables/Nebula/volume/NebulaImpostor'
import { ImpostorBaker } from '@/core/renderables/Nebula/volume/ImpostorBaker'
import { IMPOSTOR_FRAME_FILL, selectLOD } from '@/core/renderables/Nebula/volume/lod'
import { threeJS } from '@/core/graphic/ThreeJS'

const REBAKE_ANGLE = 0.15 // rad (~8.6°): rebake the impostor past this view-dir change
const IMPOSTOR_RESOLUTION = 512

/**
 * Standalone volumetric nebula: `new Nebula(params)` -> `scene.add(...)`.
 * Adaptive LOD: a raymarch proxy (NebulaVolume) near/large-on-screen, a cheap baked
 * billboard (NebulaImpostor) far/small-on-screen, crossfaded in a transition band.
 * The proxy is a unit cube scaled UNIFORMLY by `size`; anisotropy (axisRatios) is
 * applied once inside the shader via uInvAxis (mirror of NebulaField).
 */
class Nebula extends Object3D {
  public readonly params: NebulaParams
  private readonly volume: NebulaVolume
  private readonly impostor: NebulaImpostor
  private readonly baker: ImpostorBaker
  private readonly boundingRadius: number

  private readonly _center = new Vector3()
  private readonly _right = new Vector3()
  private readonly _edge = new Vector3()
  private readonly _ndcA = new Vector3()
  private readonly _ndcB = new Vector3()
  private readonly _viewSize = new Vector2()

  public constructor(params: DeepPartial<NebulaParams> = {}) {
    super()
    this.params = mergeNebulaParams(params)
    this.name = 'Nebula'
    this.boundingRadius = this.params.size

    this.volume = new NebulaVolume(this.params)
    this.add(this.volume)
    // size is the proxy half-extent; geometry is the [-1,1] cube.
    this.volume.scale.multiplyScalar(this.params.size)

    this.impostor = new NebulaImpostor()
    this.add(this.impostor)
    // billboard quad spans the bake frame so the baked sphere maps 1:1 onto it.
    this.impostor.scale.setScalar(this.params.size / IMPOSTOR_FRAME_FILL)

    this.baker = new ImpostorBaker(IMPOSTOR_RESOLUTION)
  }

  public updateObject(_delta?: number): void {
    const camera = threeJS.camera
    const { blend } = selectLOD(this.projectedScreenRadius(), this.params.quality.forceLOD)

    const impostorVisible = blend < 1

    // Refresh the bake (always at full opacity, with the volume forced visible so the
    // standalone render isn't skipped) when the impostor is needed and the view moved.
    if (impostorVisible && this.baker.shouldRebake(this._center, camera.position, REBAKE_ANGLE)) {
      const prevVisible = this.volume.visible
      this.volume.visible = true
      this.volume.material.uniforms.uOpacityScale.value = 1
      this.impostor.setTexture(this.baker.bake(this.volume, camera, this._center, this.boundingRadius))
      this.volume.visible = prevVisible
    }

    // Final crossfade state for the main render.
    this.volume.visible = blend > 0
    this.impostor.visible = impostorVisible
    this.volume.material.uniforms.uOpacityScale.value = blend
    this.impostor.setOpacity(1 - blend)
  }

  /** Projected pixel radius of the nebula's bounding sphere at the current camera. */
  private projectedScreenRadius(): number {
    const camera = threeJS.camera
    this.getWorldPosition(this._center)
    this._right.setFromMatrixColumn(camera.matrixWorld, 0) // camera world X axis
    this._edge.copy(this._center).addScaledVector(this._right, this.boundingRadius)

    this._ndcA.copy(this._center).project(camera)
    this._ndcB.copy(this._edge).project(camera)

    threeJS.renderer.getSize(this._viewSize)
    const dx = (this._ndcB.x - this._ndcA.x) * 0.5 * this._viewSize.x
    const dy = (this._ndcB.y - this._ndcA.y) * 0.5 * this._viewSize.y
    return Math.hypot(dx, dy)
  }

  public dispose(): void {
    this.volume.geometry.dispose()
    this.volume.material.dispose()
    this.impostor.geometry.dispose()
    this.impostor.material.dispose()
    this.baker.dispose()
  }
}

export { Nebula }
