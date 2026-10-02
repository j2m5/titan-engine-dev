import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { regolithDiffuse } from '../asteroidSurface/brdfMirror'

const frag: string = PlanetShaderTemplate.fragmentShader
const main: string = frag.slice(frag.indexOf('void main()'))

function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg']) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
}

describe('CPU-зеркало закона реголита (brdfMirror.regolithDiffuse)', () => {
  it('доля 0 и всплеск 0 — ровно ламберт', () => {
    for (const nl of [-0.3, 0, 0.2, 0.7, 1]) {
      for (const nv of [0, 0.4, 1]) expect(regolithDiffuse(nl, nv, 0.3, 0, 0)).toBe(Math.max(nl, 0))
    }
  })

  it('полнолуние (N·L = N·V) — вес 1 по всему диску', () => {
    for (const c of [1, 0.5, 0.1]) expect(regolithDiffuse(c, c, 1, 1, 0)).toBeCloseTo(1, 12)
  })

  it('всплеск: 1 + surge в противостоянии, почти 0 при g = 0.5 рад', () => {
    expect(regolithDiffuse(1, 1, 1, 1, 0.3)).toBeCloseTo(1.3, 12)
    expect(regolithDiffuse(1, 1, Math.cos(0.5), 1, 0.3)).toBeLessThan(1 + 0.01 * 0.3)
  })

  it('скользящий взгляд на освещённый склон — вес до 2, конечный', () => {
    const w = regolithDiffuse(1, 0, 0, 1, 0)
    expect(w).toBeCloseTo(2, 12)
    expect(Number.isFinite(regolithDiffuse(0, 0, 0, 1, 0))).toBe(true)
  })
})

describe('сборка lit: избыток веса реголита не уводит тень ниже пола', () => {
  const mixv = (a: number, d: number, t: number): number => a * (1 - t) + d * t
  const lit = (a: number, d: number, w: number): number => mixv(a, d, Math.min(w, 1)) + Math.max(w - 1, 0) * d

  it('в тени (direct 0) lit неотрицателен и равен полу·(1 − min(w, 1))', () => {
    for (const w of [0.5, 1, 1.3, 2]) {
      expect(lit(0.15, 0, w)).toBeGreaterThanOrEqual(0)
      expect(lit(0.15, 0, w)).toBeCloseTo(0.15 * (1 - Math.min(w, 1)), 12)
    }
  })

  it('на свету (direct 1, w = 1.3) lit = 1.3', () => {
    expect(lit(0.15, 1, 1.3)).toBeCloseTo(1.3, 12)
  })
})

describe('PlanetShaderTemplate: вес прямого света', () => {
  it('ламберт по умолчанию, реголит под USE_REGOLITH, обе строки lit читают directWeight', () => {
    expect(main).toContain('float directWeight = max(NdotLraw, 0.0);')
    expect(main).toMatch(/#ifdef USE_REGOLITH\s+directWeight = asteroidRegolithDiffuse\(NdotLraw, dot\(normal, viewDir\), dot\(lightDirection, viewDir\), uRegolithMix, uOppositionSurge\);\s+#endif/)
    expect(main).toContain('vec3 litDirect = vec3(directGain) * uLightColor * sunTintMix;')
    expect(main).toContain('vec3 litDirect = vec3(directGain) * sunTintMix;')
    expect(main).toContain('vec3 lit = mix(ambient, litDirect, min(directWeight, 1.0)) + max(directWeight - 1.0, 0.0) * litDirect;')
    expect(main).not.toContain('max(NdotLraw, 0.0));')
  })

  it('viewDir объявлен один раз, до веса и до освещения', () => {
    expect(main.match(/vec3 viewDir = normalize\(vViewPosition\);/g)).toHaveLength(1)
    const decl = main.indexOf('vec3 viewDir = normalize(vViewPosition);')
    expect(decl).toBeGreaterThan(main.indexOf('float NdotLraw = dot(normal, lightDirection);'))
    expect(decl).toBeLessThan(main.indexOf('float directWeight'))
  })

  it('чанк и юниформы — под гейтом', () => {
    expect(frag).toMatch(/#ifdef USE_REGOLITH\s+uniform float uRegolithMix;\s+uniform float uOppositionSurge;\s+#include <asteroidBrdfFunctions>\s+#endif/)
  })
})

describe('PlanetShader: гейт по телу', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('Луна — реголит с юниформами; Земля — без дефайна', () => {
    const moon = new PlanetShader(Actor.find(19)!)
    expect(moon.defines.USE_REGOLITH).toBe('1')
    expect(moon.uniforms.uRegolithMix.value).toBe(1)
    expect(moon.uniforms.uOppositionSurge.value).toBe(0.3)
    const earth = new PlanetShader(Actor.find(7)!)
    expect(earth.defines.USE_REGOLITH).toBeUndefined()
    expect(earth.uniforms.uRegolithMix.value).toBe(0)
  })

  it('regolithMix 0 в данных у безатмосферного тела — без дефайна', () => {
    const stub = {
      renderingObject: { getAttribute: () => ({ emission: 1, bumpScale: 1, regolithMix: 0 }) },
      children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
      resources: { where: () => ({ first: () => undefined }) }
    } as unknown as Actor
    expect(new PlanetShader(stub).defines.USE_REGOLITH).toBeUndefined()
  })
})
