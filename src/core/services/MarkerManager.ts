import { injectable } from 'inversify'
import { Object3D } from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

export type MarkerShape = 'circle' | 'diamond' | 'hex'

export type MarkerOptions = {
  object: Object3D
  label: string
  color: string
  shape: MarkerShape
  onClick?: () => void
}

@injectable()
class MarkerManager {
  public add(options: MarkerOptions): void {
    const wrapper: HTMLElement = document.createElement('div')
    const element: HTMLElement = document.createElement('div')
    const text: HTMLElement = document.createElement('div')

    wrapper.className = 'marker'
    element.className = options.shape
    options.shape === 'hex' ? (element.style.background = options.color) : (element.style.borderColor = options.color)
    text.className = 'label'
    text.innerText = options.label

    wrapper.appendChild(element)

    if (options.onClick) {
      element.style.cursor = 'pointer'
      element.onclick = options.onClick
    }

    const marker: CSS2DObject = new CSS2DObject(wrapper)
    const label: CSS2DObject = new CSS2DObject(text)

    options.object.add(marker, label)
  }

  public remove(name: string): void {
    //
  }

  public clear(): void {
    //
  }
}

export { MarkerManager }
