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
    expect(block).toContain('cloudShadow = 1.0 - uCloudShadowStrength * alphaShadow * smoothstep(0.0, 0.2, muS);')
    expect(block).toContain('float cosZ = max(muS, CLOUD_SHADOW_MIN_COS);')
    expect(block).not.toContain('dFdx')
  })

  it('тень множит только прямой свет: входит в directGain, не в ambient', () => {
    expect(frag).toContain('float directGain = mix(1.0, occlusion, uTerrainOcclusionDirect) * cloudShadow;')
    expect(frag).toContain('vec3 ambient = uTerrainAmbient * skyTerm * occlusion;')
  })
})
