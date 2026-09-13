import { afterEach, beforeEach, vi } from 'vitest'
import { Texture } from 'three'
import '@/core/framework/TitanThree'
import { ICE_GLINT_F0, iceGlint, iceGlintPower } from '@/core/materials/shaders/lib/chunks/terrainGlintMath'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { terrainDetailFunctions } from '@/core/materials/shaders/lib/chunks/TerrainDetail'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { ResourceType } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'

// readWaterLevelMeters — по умолчанию проксирует настоящий; override только
// на тест «Европа с водной оболочкой» (паттерн vi.hoisted из TerrainShadowWiring.spec).
const waterLevelOverride = vi.hoisted(() => ({ value: undefined as number | undefined }))

vi.mock('@/core/terrain/waterLevel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/terrain/waterLevel')>()

  return {
    ...actual,
    readWaterLevelMeters: (model: Parameters<typeof actual.readWaterLevelMeters>[0]) =>
      waterLevelOverride.value === undefined ? actual.readWaterLevelMeters(model) : waterLevelOverride.value
  }
})

const EUROPA_ID = 21
const MOON_ID = 19

function europa(): Actor {
  return Actor.find(EUROPA_ID)!
}

function moon(): Actor {
  return Actor.find(MOON_ID)!
}

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

function pathOf(actor: Actor, kind: ResourceType): string {
  return actor.resources.where('resourceType', kind).first()!.getAttribute('path') as string
}

// Конструктор шейдера читает заглушки через getTextureOrMake — промах строит
// PlaceholderTexture (canvas 2d, в jsdom недоступен).
function seedPlaceholderKeys(actor: Actor): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(pathOf(actor, 'diffuse'))
}

// содержимое не важно: материал спрашивает только факт наличия карты в реестре
function seedHeightMap(actor: Actor): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(pathOf(actor, 'height'), {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

describe('iceGlint: CPU-зеркало', () => {
  it('степень: шероховатость 1 → 8, 0 → 512, между — по квадрату глянца', () => {
    expect(iceGlintPower(1)).toBe(8)
    expect(iceGlintPower(0)).toBe(512)
    expect(iceGlintPower(0.5)).toBeCloseTo(8 + 504 * 0.25, 12)
  })

  it('шероховатый (1) — ноль; гладкий в зеркальном направлении — (p+8)/8π·F0', () => {
    expect(iceGlint(1, 1, 1)).toBe(0)
    expect(iceGlint(1, 1, 0)).toBeCloseTo(((512 + 8) / (8 * Math.PI)) * ICE_GLINT_F0, 9)
  })

  it('растёт к скользящему взгляду (Френель) и гаснет вне зеркального направления', () => {
    expect(iceGlint(1, 0.1, 0.2)).toBeGreaterThan(iceGlint(1, 1, 0.2))
    expect(iceGlint(0.9, 1, 0)).toBeLessThan(iceGlint(1, 1, 0) * 1e-10)
  })

  it('вне нормали, средняя шероховатость: число сходится с формулой', () => {
    // power = 8 + 504·0.25 = 134; fresnel = 0.018 + 0.982·0.5^5 = 0.0486875
    expect(iceGlint(0.99, 0.5, 0.5)).toBeCloseTo(0.0178863631662164, 12)
  })

  it('верхний кламп: dot(V, halfVec) выше 1 (float32-округление) не даёт NaN', () => {
    const overshoot = iceGlint(1, 1 + 1e-7, 0)
    expect(Number.isFinite(overshoot)).toBe(true)
    expect(overshoot).toBe(iceGlint(1, 1, 0))
  })
})

describe('Шейдер: блеск льда', () => {
  const frag = PlanetShaderTemplate.fragmentShader

  it('функция под гейтом, формула как у зеркала', () => {
    const start = frag.indexOf('#ifdef USE_TERRAIN_GLINT')
    const block = frag.slice(start, frag.indexOf('#endif', start))
    expect(block).toContain('uniform float uIceGlintStrength;')
    expect(block).toContain('#define ICE_GLINT_F0 0.018')
    expect(block).toContain('float power = mix(8.0, 512.0, gloss * gloss);')
    expect(block).toContain('float fresnel = ICE_GLINT_F0 + (1.0 - ICE_GLINT_F0) * pow(1.0 - clamp(dot(viewDir, halfVec), 0.0, 1.0), 5.0);')
    expect(block).toContain('return (power + 8.0) / 25.1327412 * pow(max(dot(normal, halfVec), 0.0), power) * fresnel * gloss * gloss;')
  })

  it('добавка после ограничителя bloom и до потолка, с тенью рельефа и колец', () => {
    const clampAt = frag.indexOf('finalColor = clamp(finalColor, 0.0, 0.99);')
    const glintAt = frag.indexOf('finalColor += terrainIceGlint(normal, lightDirection, viewDir, terrainRoughness) * uIceGlintStrength')
    const ceilingAt = frag.indexOf('gl_FragColor = vec4(min(finalColor, vec3(4.0)), 1.0);')
    expect(clampAt).toBeGreaterThan(-1)
    expect(glintAt).toBeGreaterThan(clampAt)
    expect(ceilingAt).toBeGreaterThan(glintAt)
    expect(frag.slice(glintAt, ceilingAt)).toContain('* smoothstep(0.0, 0.15, NdotLraw) * ringShadowFactor * terrainShadow;')
    expect((frag.match(/blinnPhongGlint\(/g) ?? []).length).toBe(3) // определение + два вызова, как прежде
  })

  it('шероховатость: хост объявляет 1.0 до детали и передаёт в applyTerrainDetail', () => {
    expect(frag).toContain('float terrainRoughness = 1.0;')
    expect(frag.indexOf('float terrainRoughness = 1.0;')).toBeLessThan(frag.indexOf('applyTerrainDetail('))
    expect(frag).toContain('applyTerrainDetail(nLocal, albedoMul, occlusion, vDetailPos, vDetailPos2, length(vViewPosition), terrainSlopeTan, terrainRoughness);')
  })

  it('деталь: канал G тех же выборок ARM, смешение по маске и затуханию', () => {
    expect(terrainDetailFunctions).toContain('out vec3 nOut, out float aoOut, out vec3 tintOut, out float roughnessOut')
    expect(terrainDetailFunctions).toContain('roughnessOut = clamp(armSample.g, 0.0, 1.0);')
    expect(terrainDetailFunctions).toContain('inout float roughness)')
    expect(terrainDetailFunctions).toContain('roughness = mix(1.0, rNative, fade1);')
    expect(terrainDetailFunctions).toContain('roughness = mix(1.0, rSteep, fade1);')
    expect(terrainDetailFunctions).toContain('roughness = mix(1.0, mix(rNative, rSteep, m), fade1);')
    // ARM читается по-прежнему один раз на набор
    const helper = terrainDetailFunctions.slice(terrainDetailFunctions.indexOf('void sampleDetailSet('), terrainDetailFunctions.indexOf('void applyTerrainDetail('))
    expect((helper.match(/triplanarArmDetiled\(/g) ?? []).length).toBe(1)
  })
})

describe('PlanetMaterial: гейт блеска льда', () => {
  beforeEach(() => {
    seedHeightMap(europa())
    seedPlaceholderKeys(europa())
    seedTexture(pathOf(europa(), 'detailNormal'), 8, 4)
  })

  afterEach(() => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
    waterLevelOverride.value = undefined
  })

  it('Европа (ice-airless, без воды): USE_TERRAIN_GLINT и uIceGlintStrength 0.35', () => {
    const material = new PlanetMaterial(europa())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_GLINT).toBe('1')
    expect(material.uniforms.uIceGlintStrength.value).toBe(0.35)
  })

  it('Луна (rocky-airless): дефайна нет, юниформ 0', () => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
    seedHeightMap(moon())
    seedPlaceholderKeys(moon())
    seedTexture(pathOf(moon(), 'detailNormal'), 8, 4)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_GLINT).toBeUndefined()
    expect(material.uniforms.uIceGlintStrength.value).toBe(0)
  })

  it('Европа с водной оболочкой: дефайна нет — блик суши под водой был бы вторым бликом', () => {
    waterLevelOverride.value = 0

    const material = new PlanetMaterial(europa())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_GLINT).toBeUndefined()
  })
})
