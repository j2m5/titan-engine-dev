import { BoxGeometry, BufferGeometry, Mesh } from 'three'
import { NebulaMaterial } from '@/core/renderables/Nebula/NebulaMaterial'
import { NebulaParameters, NebulaParametersInit } from '@/core/renderables/Nebula/NebulaParameters'
import { threeJS } from '@/core/graphic/ThreeJS'

class Nebula extends Mesh {
  declare public geometry: BufferGeometry
  declare public material: NebulaMaterial

  public readonly parameters: NebulaParameters

  public constructor(init: NebulaParametersInit = {}) {
    super()
    this.parameters = new NebulaParameters(init)

    this.__setup()
  }

  __setup(): void {
    const side = this.parameters.radius * 2
    this.geometry = new BoxGeometry(side, side, side)

    this.material = new NebulaMaterial(this.parameters)

    this.position.copy(this.parameters.center)

    this.name = 'Nebula'
    this.userData.type = 'nebula'

    // куб не должен отсекаться фрустумом, когда камера внутри
    this.frustumCulled = false

    this.onBeforeRender = (): void => {
      this.material.update(this, threeJS.camera)
    }
  }
}

export { Nebula }
