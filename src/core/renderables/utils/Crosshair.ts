import { IRenderable } from '@/core/renderables/IRenderable'
import { Object3D } from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

class Crosshair implements IRenderable {
  public object3D: Object3D

  public constructor() {
    const div: HTMLDivElement = document.createElement('div')
    const wrapper: HTMLDivElement = document.createElement('div')
    const top: HTMLDivElement = document.createElement('div')
    const bottom: HTMLDivElement = document.createElement('div')
    const left: HTMLDivElement = document.createElement('div')
    const right: HTMLDivElement = document.createElement('div')

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

    this.object3D = new CSS2DObject(div)
  }

  public build(): Object3D {
    this.object3D.name = 'crosshair'
    this.object3D.userData.type = 'crosshair'

    return this.object3D
  }

  public update(delta?: number): void {}
}

export { Crosshair }
