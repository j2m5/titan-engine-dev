import { DistanceBasedCSS2DObject } from '@/core/renderables/utils/DistanceBasedCSS2DObject'
import { MarkerOptions } from '@/core/services/MarkerManager'
import { SceneObserver } from '@/core/services/SceneObserver'

class ObjectMarker extends DistanceBasedCSS2DObject {
  private options: MarkerOptions

  public constructor(options: MarkerOptions, observer: SceneObserver) {
    const wrapper: HTMLElement = document.createElement('div')
    const element: HTMLElement = document.createElement('div')
    const color: string = options.model.getAttribute('color', '#ffffff')

    wrapper.className = 'marker'
    element.className = options.shape
    options.shape === 'hex' ? (element.style.background = color) : (element.style.borderColor = color)

    if (options.onClick) {
      element.style.cursor = 'pointer'
      element.onclick = options.onClick
    }

    wrapper.appendChild(element)

    super(options.model, observer, wrapper)
    this.options = options

    this.__setup()
  }

  __setup(): void {
    this.userData.priority = Math.max(
      0,
      Math.floor(Math.log10(this.options.model.physicalObject?.getAttribute('mass')) - this.options.depth)
    )
  }
}

export { ObjectMarker }
