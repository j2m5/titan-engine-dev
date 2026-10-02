import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { WaterShader } from '@/core/materials/shaders/WaterShader'
import { WATER_FAR_ALPHA2, farGlintAlpha2 } from '@/core/materials/shaders/lib/chunks/waterOctavesMath'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'

const frag: string = PlanetShaderTemplate.fragmentShader

function specularBlock(): string {
  const main = frag.indexOf('void main()')
  const open = frag.indexOf('#ifdef USE_SPECULAR', main)
  expect(open).toBeGreaterThan(-1)
  return frag.slice(open, frag.indexOf('#endif', open))
}

describe('PlanetShaderTemplate: легаси-блик воды тем же законом, что водная оболочка', () => {
  it('USE_SPECULAR — waterGlintGlsl по дальней шероховатости × gain, без pow64 и uSpecularStrength', () => {
    const block = specularBlock()
    expect(block).toContain('waterGlintGlsl(normal, lightDirection, viewDir, uWaterFarAlpha2)')
    expect(block).toContain('* uWaterGlintGain')
    expect(block).toContain('smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor * terrainShadow')
    expect(block).toContain('* (1.0 - cloudAlpha) * sunTintMix')
    expect(block).not.toContain('blinnPhongGlint')
    expect(frag).not.toContain('uSpecularStrength')
  })

  it('чанк блика включён под USE_SPECULAR, юниформы объявлены', () => {
    const decl = frag.slice(0, frag.indexOf('void main()'))
    const open = decl.indexOf('#ifdef USE_SPECULAR')
    expect(open).toBeGreaterThan(-1)
    const block = decl.slice(open, decl.indexOf('#endif', open))
    expect(block).toContain('#include <waterGlintFunctions>')
    expect(block).toContain('uniform float uWaterFarAlpha2;')
    expect(block).toContain('uniform float uWaterGlintGain;')
  })

  it('блик после клампа 0.99 и до потолка 4.0', () => {
    const clampIdx = frag.indexOf('clamp(finalColor, 0.0, 0.99)')
    const specIdx = frag.indexOf('waterGlintGlsl(normal, lightDirection, viewDir, uWaterFarAlpha2)')
    const ceilIdx = frag.indexOf('min(finalColor, vec3(4.0))')
    expect(specIdx).toBeGreaterThan(clampIdx)
    expect(ceilIdx).toBeGreaterThan(specIdx)
  })

  it('дефолты юниформов шаблона', () => {
    expect(PlanetShaderTemplate.uniforms.uWaterFarAlpha2.value).toBe(WATER_FAR_ALPHA2)
    expect(PlanetShaderTemplate.uniforms.uWaterGlintGain.value).toBe(1)
    expect(PlanetShaderTemplate.uniforms.uSpecularStrength).toBeUndefined()
  })
})

// Конструктор PlanetShader ходит в getTextureOrMake('' | 'default.png' | 'night.jpg') —
// промах строит PlaceholderTexture на canvas, которого в jsdom нет (как в TerrainLambert.spec.ts)
function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg']) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
}

// Только то, что читают оба конструктора: data, дети (атмосферы нет), ресурсы (нет)
function stubBodyActor(data: Record<string, unknown>): Actor {
  return {
    renderingObject: { getAttribute: () => data },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: { where: () => ({ first: () => undefined }) }
  } as unknown as Actor
}

describe('паритет дальней шероховатости на гейте карты высот', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('тело с заданной waterRoughness: uWaterFarAlpha2 и gain у PlanetShader и WaterShader совпадают', () => {
    const data = { emission: 1, bumpScale: 1, waterLevelMeters: 0, waterRoughness: 0.08, waterRippleStrength: 0.6, waterGlintGain: 2 }
    const actor = stubBodyActor(data)
    const planet = new PlanetShader(actor)
    const water = new WaterShader(actor)
    expect(planet.uniforms.uWaterFarAlpha2.value).toBe(farGlintAlpha2(0.08, 0.6))
    expect(water.uniforms.uWaterFarAlpha2.value).toBe(planet.uniforms.uWaterFarAlpha2.value)
    expect(water.uniforms.uWaterGlintGain.value).toBe(2)
    expect(planet.uniforms.uWaterGlintGain.value).toBe(2)
  })
})
