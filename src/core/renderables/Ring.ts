import { BufferGeometry, Mesh, RingGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { RingMaterial } from '@/core/materials/RingMaterial'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { requireRenderingData } from '@/core/helpers/renderingData'
import { IRingRenderingObject } from '@/core/models/types'

/**
 * Порядок внутри прозрачной очереди: кольцо до пыли (DUST_RENDER_ORDER) —
 * пыль его гало. К атмосфере порядок отношения не имеет: она — полноэкранный
 * эффект по глубине, и что затуманивать, решает depth-буфер.
 */
export const RING_RENDER_ORDER = 2

class Ring extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: AbstractShaderMaterial

  public constructor(model: Actor) {
    super()
    this.model = model

    this.__setup()
  }

  __setup(): void {
    // Кольцо знает свою категорию, поэтому форма `renderingObject.data` утверждается локально
    const ringData: IRingRenderingObject = requireRenderingData<IRingRenderingObject>(this.model, 'Ring')

    const innerRadius: number = toThreeJSUnits(ringData.innerRadius)
    const outerRadius: number = toThreeJSUnits(ringData.outerRadius)

    this.geometry = new RingGeometry(innerRadius, outerRadius, 256)
    this.material = new RingMaterial(this.model)

    this.name = this.model.getAttribute('name', '') + 'Ring'
    this.renderOrder = RING_RENDER_ORDER
    this.rotateX(degToRad(90))
  }
}

export { Ring }
