import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Texture, Uniform, Vector3 } from 'three'
import { InstancedAsteroidShaderTemplate as Shader } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'

interface InstancedAsteroidUniforms {
  lightPosition: Vector3
  diffuseMap: Texture | null
  bumpMap: Texture | null
  nightMap: Texture | null
  bumpScale: number
  minDistance: number
  maxDistance: number
}

class InstancedAsteroidShader extends AbstractShader<keyof InstancedAsteroidUniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      lightPosition: new Uniform(new Vector3()),
      diffuseMap: new Uniform(resourceStorage.getTexture('asteroid.jpg')),
      bumpMap: new Uniform(resourceStorage.getTexture('asteroid_bump.jpg')),
      nightMap: new Uniform(resourceStorage.getTexture('night.jpg')),
      bumpScale: new Uniform(10),
      minDistance: new Uniform(toThreeJSUnits(100)),
      maxDistance: new Uniform(toThreeJSUnits(5000))
    }
    this.name = 'InstancedAsteroidShader'
  }
}

export { InstancedAsteroidShader }
