import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Color, Texture, Uniform, Vector3 } from 'three'
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
  uDustColor: Color
  uDustDensity: number
  uDustScaleHeight: number
  uDustRingInner: number
  uDustRingOuter: number
  uDustCamRingPos: Vector3
  uDustLightDirRing: Vector3
  uDustAnglePower: number
  uDustNearFade: number
  uDustPlanetRadius: number
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
      maxDistance: new Uniform(toThreeJSUnits(5000)),
      uDustColor: new Uniform(new Color(0x9b968c)),
      uDustDensity: new Uniform(0),
      uDustScaleHeight: new Uniform(1),
      uDustRingInner: new Uniform(0),
      uDustRingOuter: new Uniform(1e9),
      uDustCamRingPos: new Uniform(new Vector3()),
      uDustLightDirRing: new Uniform(new Vector3(1, 0, 0)),
      uDustAnglePower: new Uniform(2),
      uDustNearFade: new Uniform(1),
      uDustPlanetRadius: new Uniform(0)
    }
    this.name = 'InstancedAsteroidShader'
  }
}

export { InstancedAsteroidShader }
