import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Color, Uniform, Vector3 } from 'three'
import { InstancedAsteroidShaderTemplate as Shader } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'

interface InstancedAsteroidUniforms {
  lightPosition: Vector3
  uRockColor: Color
  uColorJitter: number
  uMariaStrength: number
  uGrainStrength: number
  uGrainFreq: number
  uSpecularStrength: number
  uSpecularPower: number
  uSpecularTint: number
  uAaStart: number
  uAaEnd: number
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
      uRockColor: new Uniform(new Color(0x6b6157)),
      uColorJitter: new Uniform(0.12),
      uMariaStrength: new Uniform(0.3),
      uGrainStrength: new Uniform(0.15),
      uGrainFreq: new Uniform(22.0),
      uSpecularStrength: new Uniform(0.05),
      uSpecularPower: new Uniform(8.0),
      uSpecularTint: new Uniform(0.0),
      uAaStart: new Uniform(1.2),
      uAaEnd: new Uniform(3.0),
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
