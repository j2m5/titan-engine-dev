import { Object3D } from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { SceneObserver } from '@/core/services/SceneObserver'
import { Model } from '@/core/framework/Memoquent/Model'
import { Actor } from '@/core/models/Actor'
import { ObjectLabel } from '@/core/renderables/utils/ObjectLabel'
import { ObjectMarker } from '@/core/renderables/utils/ObjectMarker'
import { Settings } from '@/core/ports/Settings'

export type MarkerShape = 'circle' | 'diamond' | 'hex'

export type MarkerOptions<TModel extends Model = Actor> = {
  model: TModel
  object: Object3D
  shape: MarkerShape
  depth: number
  onClick?: () => void
}

type MarkerEntry = {
  marker: CSS2DObject
  label: CSS2DObject
}

class MarkerManager {
  private markers: MarkerEntry[] = []

  public constructor(
    private sceneObserver: SceneObserver,
    private settings: Settings
  ) {}

  public add(options: MarkerOptions): void {
    const marker: CSS2DObject = new ObjectMarker(options, this.sceneObserver)
    const label: CSS2DObject = new ObjectLabel(options, this.sceneObserver)

    options.object.add(marker, label)
    this.markers.push({ marker, label })
  }

  public remove(name: string): void {
    //
  }

  public dispose(): void {
    this.markers = []
  }

  public update(): void {
    if (!this.settings.showMarkers) {
      for (const entry of this.markers) {
        const element = entry.marker.element as HTMLElement
        element.style.display = 'none'
        entry.label.element.style.display = 'none'
      }
      return
    }

    const visibleRects: DOMRect[] = []

    const sorted = [...this.markers].sort((a, b) => {
      const pa = a.marker.userData.priority ?? 0
      const pb = b.marker.userData.priority ?? 0
      return pb - pa
    })

    for (const entry of sorted) {
      const element = entry.marker.element as HTMLElement

      if (!element) continue

      const rect = element.getBoundingClientRect()
      const hasIntersection = visibleRects.some((r) => this.intersects(rect, r))

      if (hasIntersection) {
        element.style.display = 'none'
        entry.label.element.style.display = 'none'
      } else {
        element.style.display = 'block'
        entry.label.element.style.display = 'block'
        visibleRects.push(rect)
      }
    }
  }

  private intersects(a: DOMRect, b: DOMRect): boolean {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
  }
}

export { MarkerManager }
