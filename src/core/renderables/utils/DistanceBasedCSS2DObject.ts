import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Actor } from '@/core/models/Actor'
import { SceneObserver } from '@/core/services/SceneObserver'
import { smoothstep } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'

abstract class DistanceBasedCSS2DObject extends CSS2DObject {
  public model: Actor
  private observer: SceneObserver

  protected constructor(model: Actor, observer: SceneObserver, element: HTMLElement = document.createElement('div')) {
    super(element)
    this.model = model
    this.observer = observer
  }

  public updateObject(delta?: number): void {
    const record = this.observer.data.get(this.model.getAttribute('name'))

    if (!record) return

    const min = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') * 4)
    const max = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') * 8)

    const fade = smoothstep(record.distance, min, max)

    this.element.style.opacity = `${fade}`
  }
}

export { DistanceBasedCSS2DObject }
