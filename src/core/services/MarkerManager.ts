import { Object3D, Vector3 } from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Entity } from '@/core/framework/Entity'
import { injectable } from 'inversify'

export type MarkerShape = 'circle' | 'square' | 'diamond'

export type MarkerOptions = {
  entity: Entity
  label: string
  shape: MarkerShape
  offset?: Vector3
  onClick?: () => void
}

@injectable()
class MarkerManager {
  public map: Map<Entity, CSS2DObject> = new Map<Entity, CSS2DObject>()

  public add(options: MarkerOptions): void {
    const element: HTMLElement = document.createElement('div')
    const wrapper: HTMLElement = document.createElement('div')
    const shape: HTMLElement = document.createElement('div')
    const label: HTMLElement = document.createElement('span')

    element.className = 'marker'
    wrapper.className = 'marker-wrapper'
    shape.className = `marker-shape marker--${options.shape}`
    label.className = 'label'
    label.innerText = options.label

    element.appendChild(wrapper)
    wrapper.appendChild(shape)
    wrapper.appendChild(label)

    if (options.onClick) {
      element.style.cursor = 'pointer'
      element.onclick = options.onClick
    }

    const labelObject: CSS2DObject = new CSS2DObject(element)

    labelObject.position.copy(options.offset || new Vector3())

    options.entity.getComponent(Object3D).add(labelObject)

    this.map.set(options.entity, labelObject)
  }

  public remove(entity: Entity): void {
    const marker: CSS2DObject | undefined = this.map.get(entity)

    if (marker) {
      entity.getComponent(Object3D).remove(marker)
      this.map.delete(entity)
    }
  }

  public clear(): void {
    this.map.forEach((marker: CSS2DObject, entity: Entity): void => {
      entity.getComponent(Object3D).remove(marker)
    })
    this.map.clear()
  }
}

export { MarkerManager }
