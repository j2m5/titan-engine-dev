import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Vector2, Vector3 } from 'three'
import { threeJS } from '@/core/graphic/ThreeJS'
import { UpdateContext } from '@/core/UpdateContext'

class Crosshair extends CSS2DObject {
  private arrow: HTMLElement
  private pos: Vector3 = new Vector3()
  private dir: Vector2 = new Vector2()
  private edge: Vector2 = new Vector2()

  public constructor() {
    const div = document.createElement('div')
    const wrapper = document.createElement('div')
    const top = document.createElement('div')
    const bottom = document.createElement('div')
    const left = document.createElement('div')
    const right = document.createElement('div')

    top.className = 'triangle-top'
    bottom.className = 'triangle-bottom'
    left.className = 'triangle-left'
    right.className = 'triangle-right'

    wrapper.className = 'crosshair-wrapper'

    div.appendChild(wrapper)
    wrapper.appendChild(top)
    wrapper.appendChild(bottom)
    wrapper.appendChild(left)
    wrapper.appendChild(right)

    div.className = 'crosshair'
    div.style.backgroundColor = 'transparent'

    super(div)
    this.name = 'crosshair'
    this.arrow = this.createArrow()

    this.__setup()
  }

  __setup(): void {
    this.addEventListener('removed', () => {
      this.arrow.style.display = 'none'
    })
  }

  public updateObject(ctx: UpdateContext): void {
    const worldPosition = this.getWorldPosition(this.pos)
    worldPosition.project(threeJS.camera)

    const inView =
      worldPosition.z > -1 &&
      worldPosition.z < 1 &&
      worldPosition.x >= -1 &&
      worldPosition.x <= 1 &&
      worldPosition.y >= -1 &&
      worldPosition.y <= 1

    if (inView) {
      this.arrow.style.display = 'none'

      return
    }

    this.updateArrow(worldPosition)
  }

  private createArrow(): HTMLElement {
    const arrow = document.createElement('div')

    arrow.style.position = 'fixed'
    arrow.style.width = '0'
    arrow.style.height = '0'
    arrow.style.borderTop = '7px solid transparent'
    arrow.style.borderBottom = '7px solid transparent'
    arrow.style.borderLeft = '25px solid red'
    arrow.style.pointerEvents = 'none'
    arrow.style.zIndex = '100000'
    arrow.style.display = 'none'

    document.body.appendChild(arrow)

    return arrow
  }

  private updateArrow(ndc: Vector3): void {
    this.arrow.style.display = 'block'

    const dir = this.dir.set(ndc.x, ndc.y).normalize()

    const edge = this.projectToScreenEdge(dir, 0.97)

    const screenX = (edge.x * 0.5 + 0.5) * window.innerWidth
    const screenY = (-edge.y * 0.5 + 0.5) * window.innerHeight

    const angle = Math.atan2(-dir.y, dir.x)

    this.arrow.style.left = `${screenX}px`
    this.arrow.style.top = `${screenY}px`
    this.arrow.style.transform = `
      translate(-50%, -50%)
      rotate(${angle}rad)
    `
  }

  private projectToScreenEdge(dir: Vector2, margin: number): Vector2 {
    const absX = Math.abs(dir.x)
    const absY = Math.abs(dir.y)

    if (absX > absY) {
      return this.edge.set(Math.sign(dir.x) * margin, (dir.y / absX) * margin)
    } else {
      return this.edge.set((dir.x / absY) * margin, Math.sign(dir.y) * margin)
    }
  }
}

export { Crosshair }
