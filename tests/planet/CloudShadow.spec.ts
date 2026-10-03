import { describe, expect, it } from 'vitest'
import { cloudLayerFunctions } from '@/core/materials/shaders/lib/chunks/CloudLayer'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'

describe('TerrainShaderTemplate: тени облаков на земле', () => {
  const frag: string = TerrainShaderTemplate.fragmentShader
  const start = frag.indexOf('#ifdef USE_CLOUD_SHADOW')
  const block = frag.slice(start, frag.indexOf('#endif', start))

  it('вызов cloudShadowAt под USE_CLOUD_SHADOW; тело (сдвинутая выборка, кап косинуса, гашение) живёт в чанке CloudLayer', () => {
    expect(start).toBeGreaterThan(-1)
    // тело тени живёт в чанке CloudLayer (общий закон с водой); здесь — вызов
    expect(block).toContain('cloudShadow = cloudShadowAt(dirLocal, sunLocal, muS);')
    expect(block).not.toContain('#define CLOUD_SHADOW_MIN_COS')
    expect(cloudLayerFunctions).toContain('#define CLOUD_SHADOW_MIN_COS 0.15')
    expect(cloudLayerFunctions).toContain('texture2D(cloudMap, uvShadow)')
    expect(cloudLayerFunctions).toContain('float cosZ = max(muS, CLOUD_SHADOW_MIN_COS);')
    expect(block).not.toContain('dFdx')
  })

  it('сдвиг uv — восточно-северный базис: u по 2πR cos φ, v по πR', () => {
    expect(cloudLayerFunctions).toContain('vec3 northUnit = normalize(cross(dirLocal, eastUnit));')
    expect(cloudLayerFunctions).toContain('vec2 uvShadow = uv + vec2(dot(offsetUnits, eastUnit) / (6.2831853 * uBodyRadiusUnits * cosLat),')
    expect(cloudLayerFunctions).toContain('dot(offsetUnits, northUnit) / (3.1415927 * uBodyRadiusUnits));')
  })

  it('тень множит только прямой свет: входит в directGain, не в ambient (оба пути)', () => {
    for (const source of [frag, SphereSurfaceShaderTemplate.fragmentShader]) {
      expect(source).toContain('float directGain = mix(1.0, occlusion, uTerrainOcclusionDirect) * cloudShadow;')
      expect(source).toContain('vec3 ambient = uTerrainAmbient * skyTerm * occlusion;')
    }
  })

  it('на сфере тени облаков нет: дефайн не читается', () => {
    expect(SphereSurfaceShaderTemplate.fragmentShader).not.toContain('USE_CLOUD_SHADOW')
  })
})
