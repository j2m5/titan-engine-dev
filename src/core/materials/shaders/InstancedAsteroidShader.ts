import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Texture, Uniform, Vector3 } from 'three'
import { InstancedAsteroidShaderTemplate as Shader } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { getTextureByKey } from '@/config/textures'
import { toThreeJSUnits } from '@/core/helpers/scaling'

interface InstancedAsteroidUniforms {
  lightPosition: Vector3
  diffuseMap: Texture | null
  nightMap: Texture | null
  minDistance: number
  maxDistance: number
}

class InstancedAsteroidShader extends AbstractShader<keyof InstancedAsteroidUniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      lightPosition: new Uniform(new Vector3()),
      diffuseMap: new Uniform(getTextureByKey('asteroid.jpg')),
      nightMap: new Uniform(getTextureByKey('night.jpg')),
      minDistance: new Uniform(toThreeJSUnits(100)),
      maxDistance: new Uniform(toThreeJSUnits(5000))
    }
    this.name = 'InstancedAsteroidShader'
  }
}

export { InstancedAsteroidShader }
