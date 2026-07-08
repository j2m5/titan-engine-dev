import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Color, Texture, Uniform, Vector3 } from 'three'
import { InstancedAsteroidShaderTemplate as Shader } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'

interface InstancedAsteroidUniforms {
  lightPosition: Vector3
  uRockColor: Color
  uColorJitter: number
  uMariaStrength: number
  uSpecularStrength: number
  uSpecularPower: number
  uSpecularTint: number
  uAaStart: number
  uAaEnd: number
  uRockDiffMap: Texture | null
  uRockNorMap: Texture | null
  uRockArmMap: Texture | null
  uDetailMapsEnabled: number
  uDetailScale: number
  uDetailSaturation: number
  uDetailBrightness: number
  uDetailNormalScale: number
  uDetailAoInfluence: number
  uDetailRoughInfluence: number
  uTintStrength: number
  uCraterFreq: number
  uCraterDensity: number
  uCraterRadius: number
  uCraterDepth: number
  uCraterOctaves: number
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
  uDustRadialMap: Texture | null
  uDustRadialMapScale: number
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
      uSpecularStrength: new Uniform(0.05),
      uSpecularPower: new Uniform(8.0),
      uSpecularTint: new Uniform(0.0),
      uAaStart: new Uniform(1.2),
      uAaEnd: new Uniform(3.0),
      // Фотограмметрический PBR-микрослой (см. чанк TriplanarDetail); enabled 0 —
      // текстуры не загрузились, слой выключен
      uRockDiffMap: new Uniform(null),
      uRockNorMap: new Uniform(null),
      uRockArmMap: new Uniform(null),
      uDetailMapsEnabled: new Uniform(0),
      uDetailScale: new Uniform(1),
      uDetailSaturation: new Uniform(0.35),
      uDetailBrightness: new Uniform(1.6),
      uDetailNormalScale: new Uniform(1),
      uDetailAoInfluence: new Uniform(0.8),
      uDetailRoughInfluence: new Uniform(0.7),
      uTintStrength: new Uniform(0.25),
      uCraterFreq: new Uniform(4.0),
      uCraterDensity: new Uniform(0.6),
      uCraterRadius: new Uniform(0.5),
      uCraterDepth: new Uniform(0.5),
      uCraterOctaves: new Uniform(1),
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
      // Радиальный профиль пыли из альфы текстуры кольца; scale 0 — выключен
      uDustRadialMap: new Uniform(null),
      uDustRadialMapScale: new Uniform(0),
      uShapeAmpMin: new Uniform(0),
      uShapeAmpMax: new Uniform(0),
      uShapeFreq: new Uniform(1)
    }
    this.name = 'InstancedAsteroidShader'
  }
}

export { InstancedAsteroidShader }
