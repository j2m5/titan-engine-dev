import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Actor } from '@/core/models/Actor'
import { ObservableRecord, SceneObserver } from '@/core/services/SceneObserver'
import { smoothstep } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'

abstract class DistanceBasedCSS2DObject extends CSS2DObject {
  public model: Actor
  private observer: SceneObserver

  private readonly MASS_WEIGHT = 1
  private readonly DEPTH_WEIGHT = 1
  private readonly DISTANCE_WEIGHT = 2

  protected constructor(model: Actor, observer: SceneObserver, element: HTMLElement = document.createElement('div')) {
    super(element)
    this.model = model
    this.observer = observer
  }

  public updateObject(delta?: number): void {
    const record: ObservableRecord | undefined = this.observer.data.get(this.model.getAttribute('name'))

    if (!record) return

    const min = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') * 4)
    const max = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') * 8)

    const fade = smoothstep(record.distance, min, max)

    this.element.style.opacity = `${fade}`

    if (this.userData.depth) {
      const mass = Math.log10(this.model.physicalObject?.getAttribute('mass'))
      const distance = Math.log10(record.distance + 1)

      this.userData.priority = Math.max(
        0,
        mass * this.MASS_WEIGHT - this.userData.depth * this.DEPTH_WEIGHT - distance * this.DISTANCE_WEIGHT
      )
    }
  }
}

export { DistanceBasedCSS2DObject }
