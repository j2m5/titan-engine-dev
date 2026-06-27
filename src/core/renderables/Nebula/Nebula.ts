import { Object3D } from 'three'
import { DeepPartial, NebulaParams, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { toThreeJSUnits } from '@/core/helpers/scaling'

/**
 * Standalone volumetric nebula: `new Nebula(params)` -> `scene.add(...)`.
 * Owns a bounding-proxy mesh running the raymarch material. The proxy is a unit
 * cube scaled UNIFORMLY by `size`; anisotropy (axisRatios) is applied once inside
 * the shader via uInvAxis (mirror of NebulaField), so scaling the proxy by the
 * ratios as well would double the anisotropy.
 */
class Nebula extends Object3D {
  public readonly params: NebulaParams
  private readonly volume: NebulaVolume

  public constructor(params: DeepPartial<NebulaParams> = {}) {
    super()
    this.params = mergeNebulaParams(params)
    this.name = 'Nebula'

    this.volume = new NebulaVolume(this.params)
    this.add(this.volume)

    // size is the proxy half-extent in Three.js units; geometry is the [-1,1] cube.
    this.volume.scale.setScalar(toThreeJSUnits(this.params.size))
  }

  public updateObject(_delta?: number): void {
    // The volume's per-frame work runs in its own onBeforeRender; the child is
    // also visited by SceneManager.traverse, so nothing to delegate here.
  }
}

export { Nebula }
