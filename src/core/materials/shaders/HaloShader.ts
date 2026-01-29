import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Color, Uniform, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { HaloShaderTemplate as Shader } from '@/core/materials/shaders/lib/HaloShaderTemplate'
import { Colorable, IHaloRenderingObject, ValueOf } from '@/core/models/types'
import { normalizeColor } from '@/core/materials/shaders/lib/helpers'

interface HaloUniforms {
  lightDirection: Vector3
  dayColor: Color
  nightColor: Color
}

class HaloShader extends AbstractShader<keyof HaloUniforms> {
  private readonly model: Actor

  public constructor(model: Actor) {
    super(Shader)
    this.model = model

    const haloData: Record<
      keyof IHaloRenderingObject,
      ValueOf<IHaloRenderingObject>
    > = this.model.renderingObject?.getAttribute('data')

    const day: Colorable = normalizeColor(haloData.day as Colorable)
    const night: Colorable = normalizeColor(haloData.night as Colorable)

    this.uniforms = {
      lightDirection: new Uniform(new Vector3()),
      dayColor: new Uniform(day),
      nightColor: new Uniform(night)
    }
    this.name = 'HaloShader'
  }
}

export { HaloShader }
