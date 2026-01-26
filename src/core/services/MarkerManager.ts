import { injectable } from 'inversify'
import { Object3D, Vector3 } from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

export type MarkerShape = 'circle' | 'square' | 'diamond' | 'hex'

export type MarkerOptions = {
  object: Object3D
  label: string
  shape: MarkerShape
  offset?: Vector3
  onClick?: () => void
}

@injectable()
class MarkerManager {
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

    options.object.add(labelObject)
  }

  public remove(name: string): void {
    //
  }

  public clear(): void {
    //
  }
}

export { MarkerManager }
