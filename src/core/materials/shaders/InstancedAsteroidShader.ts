import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Color, Texture, Uniform, Vector3 } from 'three'
import { InstancedAsteroidShaderTemplate as Shader } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'

interface InstancedAsteroidUniforms {
  lightPosition: Vector3
  bumpMap: Texture | null
  bumpScale: number
  uRockColorC: Color
  uRockColorS: Color
  uRockColorM: Color
  uRockTypeT1: number
  uRockTypeT2: number
  uTintStrength: number
  uCraterFreq: number
  uCraterDensity: number
  uCraterRadius: number
  uCraterDepth: number
  uCraterOctaves: number
  uCrackWidth: number
  uCrackIntensity: number
  uCrackPatchiness: number
  uAoStrength: number
  uCraterNormalScale: number
  uSurfaceAmbient: number
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
  uShapeAmpMin: number
  uShapeAmpMax: number
  uShapeFreq: number
}

class InstancedAsteroidShader extends AbstractShader<keyof InstancedAsteroidUniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      lightPosition: new Uniform(new Vector3()),
      bumpMap: new Uniform(resourceStorage.getTexture('asteroid_bump.jpg')),
      bumpScale: new Uniform(10),
      uRockColorC: new Uniform(new Color(0x2e2a26)),
      uRockColorS: new Uniform(new Color(0x6b6157)),
      uRockColorM: new Uniform(new Color(0x7a756e)),
      uRockTypeT1: new Uniform(0.55),
      uRockTypeT2: new Uniform(0.9),
      uTintStrength: new Uniform(0.25),
      uCraterFreq: new Uniform(4.0),
      uCraterDensity: new Uniform(0.6),
      uCraterRadius: new Uniform(0.5),
      uCraterDepth: new Uniform(0.5),
      uCraterOctaves: new Uniform(1),
      uCrackWidth: new Uniform(0.05),
      uCrackIntensity: new Uniform(0.5),
      uCrackPatchiness: new Uniform(0.7),
      uAoStrength: new Uniform(0.6),
      uCraterNormalScale: new Uniform(1.0),
      uSurfaceAmbient: new Uniform(0.03),
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
      uDustPlanetRadius: new Uniform(0),
      uShapeAmpMin: new Uniform(0),
      uShapeAmpMax: new Uniform(0),
      uShapeFreq: new Uniform(1)
    }
    this.name = 'InstancedAsteroidShader'
  }
}

export { InstancedAsteroidShader }
