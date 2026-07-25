import { BufferGeometry, Mesh, RingGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { RingMaterial } from '@/core/materials/RingMaterial'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { IRingRenderingObject } from '@/core/models/types'

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
    // `IRenderingObject.data` — это `Record<string, unknown>`: схема БД не различает
    // конфиги по категориям. Кольцо знает свою категорию, поэтому форма утверждается локально.
    const ringData = this.model.renderingObject?.getAttribute('data') as IRingRenderingObject | undefined

    if (!ringData) {
      throw new Error(`[Ring] У актора "${this.model.getAttribute('name', '?')}" отсутствует renderingObject.data`)
    }

    const innerRadius: number = toThreeJSUnits(ringData.innerRadius)
    const outerRadius: number = toThreeJSUnits(ringData.outerRadius)

    this.geometry = new RingGeometry(innerRadius, outerRadius, 256)
    this.material = new RingMaterial(this.model)

    this.name = this.model.getAttribute('name', '') + 'Ring'
    this.rotateX(degToRad(90))
  }
}

export { Ring }
