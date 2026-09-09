import { describe, expect, it } from 'vitest'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('PlanetShaderTemplate: тени облаков на земле', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader
  const start = frag.indexOf('#ifdef USE_CLOUD_SHADOW')
  const block = frag.slice(start, frag.indexOf('#endif', start))

  it('блок под USE_CLOUD_SHADOW: вторая выборка cloudMap по сдвинутому uv, кап косинуса, гашение к терминатору', () => {
    expect(start).toBeGreaterThan(-1)
    expect(block).toContain('#define CLOUD_SHADOW_MIN_COS 0.15')
    expect(block).toContain('texture2D(cloudMap, uvShadow)')
    expect(block).toContain('cloudShadow = 1.0 - uCloudShadowStrength * alphaShadow * smoothstep(0.0, 0.2, muS) * step(1e-4, length(eastLocal));')
    expect(block).toContain('float cosZ = max(muS, CLOUD_SHADOW_MIN_COS);')
    expect(block).not.toContain('dFdx')
  })

  it('сдвиг uv — восточно-северный базис: u по 2πR cos φ, v по πR', () => {
    expect(block).toContain('vec3 northUnit = normalize(cross(dirLocal, eastUnit));')
    expect(block).toContain('vec2 uvShadow = uv + vec2(dot(offsetUnits, eastUnit) / (6.2831853 * uBodyRadiusUnits * cosLat),')
    expect(block).toContain('dot(offsetUnits, northUnit) / (3.1415927 * uBodyRadiusUnits));')
  })

  it('тень множит только прямой свет: входит в directGain, не в ambient', () => {
    expect(frag).toContain('float directGain = mix(1.0, occlusion, uTerrainOcclusionDirect) * cloudShadow;')
    expect(frag).toContain('vec3 ambient = uTerrainAmbient * skyTerm * occlusion;')
  })
})
