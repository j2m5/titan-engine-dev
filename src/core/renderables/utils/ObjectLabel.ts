import { DistanceBasedCSS2DObject } from '@/core/renderables/utils/DistanceBasedCSS2DObject'
import { MarkerOptions } from '@/core/services/MarkerManager'
import { SceneObserver } from '@/core/services/SceneObserver'

class ObjectLabel extends DistanceBasedCSS2DObject {
  private options: MarkerOptions

  public constructor(options: MarkerOptions, observer: SceneObserver) {
    const text: HTMLElement = document.createElement('div')
    text.className = 'label'
    text.innerText = options.model.getAttribute('name', 'Unnamed')

    if (options.onClick) {
      text.style.cursor = 'pointer'
      text.onclick = options.onClick
    }

    super(options.model, observer, text)
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

export { ObjectLabel }
