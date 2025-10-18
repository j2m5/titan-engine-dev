import { AbstractShader } from '@/core/materials/shaders/AbstractShader.ts'
import { Color, Uniform, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor.ts'
import { HaloShaderTemplate as Shader } from '@/core/materials/shaders/lib/HaloShaderTemplate.ts'
import { IHaloRenderingObject, ValueOf } from '@/core/models/types.ts'

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
    > = this.model.renderingObject.getAttribute('data')

    this.uniforms = {
      lightDirection: new Uniform(new Vector3()),
      dayColor: new Uniform(haloData.day),
      nightColor: new Uniform(haloData.night)
    }
    this.name = 'HaloShader'
  }
}

export { HaloShader }
