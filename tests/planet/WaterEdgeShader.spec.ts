import { afterEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'

const frag: string = PlanetShaderTemplate.fragmentShader
const vert: string = PlanetShaderTemplate.vertexShader

describe('PlanetShaderTemplate: мокрая кромка берега (USE_WATER_EDGE)', () => {
  it('атрибут height и varying объявлены под объединённым гейтом полосы/кромки', () => {
    expect(vert).toContain('#if defined(USE_TERRAIN_MACRO_DETAIL) || defined(USE_WATER_EDGE)')
    expect(vert).toContain('attribute float height;')
    const fragGate = frag.indexOf('#if defined(USE_TERRAIN_MACRO_DETAIL) || defined(USE_WATER_EDGE)')
    expect(fragGate).toBeGreaterThan(-1)
    expect(frag).toContain('varying float vHeightMeters;')
    // varying объявлен ПОД гейтом (переехал из чанка сюда), не перед ним
    expect(frag.indexOf('varying float vHeightMeters;')).toBeGreaterThan(fragGate)
  })

  it('wet — от высоты карты и уровня воды, с fade средней полосы; альбедо темнеет', () => {
    expect(frag).toContain('uniform float uWaterLevelMeters;')
    expect(frag).toContain('uniform float uWetBandMeters;')
    expect(frag).toContain('uniform float uWetDarken;')
    expect(frag).toContain('float hAbove = vHeightMeters - uWaterLevelMeters;')
    expect(frag).toContain('wetEdge = (1.0 - smoothstep(0.0, uWetBandMeters, hAbove)) * (1.0 - smoothstep(uMacroFadeRange.x, uMacroFadeRange.y, length(vViewPosition)));')
    expect(frag).toContain('albedoMul *= 1.0 - uWetDarken * wetEdge;')
    // wetEdge объявлен до терраформной ветки (виден блоку глинта после композита)
    expect(frag.indexOf('float wetEdge = 0.0;')).toBeLessThan(frag.indexOf('#ifdef USE_TERRAIN_UV', frag.indexOf('void main()')))
  })

  it('glintEdge — глинт только в полосе ±W у уреза, темнение шире (весь мелкий шельф)', () => {
    expect(frag).toContain('float glintEdge = 0.0;')
    expect(frag).toContain('glintEdge = wetEdge * smoothstep(-uWetBandMeters, 0.0, hAbove);')
    // glintEdge объявлен рядом с wetEdge, до терраформной ветки
    expect(frag.indexOf('float glintEdge = 0.0;')).toBeLessThan(frag.indexOf('#ifdef USE_TERRAIN_UV', frag.indexOf('void main()')))
  })

  it('глинт: общая функция для USE_SPECULAR и кромки, одно тело', () => {
    expect((frag.match(/float blinnPhongGlint\(vec3 normal, vec3 lightDirection, vec3 viewDir\) \{/g) ?? []).length).toBe(1)
    expect((frag.match(/blinnPhongGlint\(normal, lightDirection, viewDir\)/g) ?? []).length).toBe(2)
    expect(frag).toContain('#define WET_GLOSS 0.6')
    const wetGlint = frag.indexOf('finalColor += glintEdge * blinnPhongGlint(normal, lightDirection, viewDir) * WET_GLOSS')
    const clampLine = frag.indexOf('finalColor = clamp(finalColor, 0.0, 0.99);')
    const out = frag.indexOf('gl_FragColor = vec4(min(finalColor, vec3(4.0)), 1.0);')
    expect(wetGlint).toBeGreaterThan(clampLine)
    expect(wetGlint).toBeLessThan(out)
    // те же гасители, что у спекуляра: терминатор и тень колец
    expect(frag.slice(wetGlint, wetGlint + 200)).toContain('smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor')
  })
})

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

function seedFor(actor: Actor): void {
  for (const name of ['', 'default.png', 'night.jpg']) seedTexture(name)
  for (const resource of actor.resources.all()) seedTexture(resource.getAttribute('path') as string)
  for (const path of Object.values(STEEP_DETAIL_PATHS)) seedTexture(path)
}

/** Регистрирует карту высот тела в heightFieldStorage — тем же путём, что читает heightPathOf. */
function seedHeightFieldFor(actor: Actor): void {
  const path = actor.resources.where('resourceType', 'height').first()!.getAttribute('path') as string
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(path, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

describe('PlanetMaterial: дефайн USE_WATER_EDGE и юниформы кромки', () => {
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
  })

  it('Луна (без уровня воды): дефайна нет, uWaterLevelMeters = 0', () => {
    const moon = Actor.find(19)!
    seedFor(moon)
    const material = new PlanetMaterial(moon)
    expect(material.defines.USE_WATER_EDGE).toBeUndefined()
    expect(material.uniforms.uWaterLevelMeters.value).toBe(0)
    expect(material.uniforms.uWetBandMeters.value).toBe(3)
    expect(material.uniforms.uWetDarken.value).toBe(0.35)
  })

  it('Земля: height и slope прогружены в реестре — USE_WATER_EDGE ставится вместе с USE_TERRAIN_MACRO_DETAIL', () => {
    const earth = Actor.find(7)!
    seedFor(earth)
    seedHeightFieldFor(earth)
    const material = new PlanetMaterial(earth)
    material.updateMaterial()
    expect(material.defines.USE_TERRAIN_MACRO_DETAIL).toBe('1')
    expect(material.defines.USE_WATER_EDGE).toBe('1')
    expect(material.uniforms.uWaterLevelMeters.value).toBe(0)
  })

  it('Луна: height и slope прогружены, но воды нет — USE_TERRAIN_MACRO_DETAIL есть, USE_WATER_EDGE нет', () => {
    const moon = Actor.find(19)!
    seedFor(moon)
    seedHeightFieldFor(moon)
    const material = new PlanetMaterial(moon)
    material.updateMaterial()
    expect(material.defines.USE_TERRAIN_MACRO_DETAIL).toBe('1')
    expect(material.defines.USE_WATER_EDGE).toBeUndefined()
  })

  it('Явин IV: уровень −667.2 доезжает до юниформа', () => {
    const yavin = Actor.find(83)!
    seedFor(yavin)
    const material = new PlanetMaterial(yavin)
    expect(material.uniforms.uWaterLevelMeters.value).toBeCloseTo(-667.2, 6)
  })
})
