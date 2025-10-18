import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Texture, Uniform } from 'three'
import { AccretionDiskV2ShaderTemplate as Shader } from '@/core/materials/shaders/lib/AccretionDiskV2ShaderTemplate'
import { generateTexture } from '@/core/materials/helpers'

interface AccretionDiskV2Uniforms {
  diffuseMap: Texture | null
  innerRadius: number
  outerRadius: number
}

class AccretionDiskV2Shader extends AbstractShader<keyof AccretionDiskV2Uniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      diffuseMap: new Uniform(generateTexture('#e89360')),
      innerRadius: new Uniform(120),
      outerRadius: new Uniform(250)
    }
    this.name = 'AccretionDiskV2Shader'
  }
}

export { AccretionDiskV2Shader }
