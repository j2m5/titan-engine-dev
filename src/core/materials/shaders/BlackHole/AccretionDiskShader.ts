import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  Texture,
  Uniform,
  WebGLRenderTarget
} from 'three'
import { AccretionDiskShaderTemplate as Shader } from '@/core/materials/shaders/lib/BlackHole/AccretionDiskShaderTemplate'
import { threeJS } from '@/core/graphic/ThreeJS'
import { NoiseMaterial } from '@/core/materials/BlackHole/NoiseMaterial'

interface AccretionDiskUniforms {
  time: number
  noiseTexture: Texture | null
  innerColor: Color
  outerColor: Color
}

class AccretionDiskShader extends AbstractShader<keyof AccretionDiskUniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      time: new Uniform(0),
      noiseTexture: new Uniform(this.createTexture()),
      innerColor: new Uniform(new Color('#ffd192')),
      outerColor: new Uniform(new Color('#e89360'))
    }
    this.name = 'AccretionDiskShader'
  }

  private createTexture(): Texture {
    const renderTarget: WebGLRenderTarget = new WebGLRenderTarget(128, 128, {
      generateMipmaps: false,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping
    })

    const plane: Mesh = new Mesh(new PlaneGeometry(2, 2), new NoiseMaterial())
    plane.frustumCulled = false

    const scene: Scene = new Scene()
    const camera: OrthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)

    scene.add(plane)

    threeJS.renderer.setRenderTarget(renderTarget)
    threeJS.renderer.render(scene, camera)
    threeJS.renderer.setRenderTarget(null)

    return renderTarget.texture
  }
}

export { AccretionDiskShader }
