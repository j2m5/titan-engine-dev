import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

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

class Crosshair extends CSS2DObject {
  public constructor() {
    super(div)
    this.name = 'crosshair'
  }
}

export { Crosshair }
