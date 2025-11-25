import { injectable } from 'inversify'
import { SRGBColorSpace, WebGLRenderer } from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { config } from '@/core/framework/config'

@injectable()
class RendererService {
  public renderer: WebGLRenderer
  public labelRenderer: CSS2DRenderer

  public constructor() {
    this.renderer = new WebGLRenderer(config('renderer'))
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = SRGBColorSpace

    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight)
    this.labelRenderer.domElement.style.position = 'absolute'
    this.labelRenderer.domElement.style.top = '0px'
  }
}

export { RendererService }
