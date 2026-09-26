import { vi } from 'vitest'
import { Color, Texture } from 'three'
import '@/core/framework/TitanThree'
import { frostFacing, frostLine, frostMask } from '@/core/materials/shaders/lib/chunks/frostMath'
import { resolveFrostParams } from '@/core/terrain/frostParams'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { ResourceType } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'

const on = resolveFrostParams({ frostStrength: 1, frostLineMeters: 2000, frostLineWidthMeters: 200, frostPolarDropMeters: 1000, frostAspectMeters: 300, frostSlopeMax: 0.6 }, 'x')

describe('frostMath: CPU-зеркало маски инея', () => {
  it('сила 0 — маски нет', () => {
    expect(frostMask(resolveFrostParams(undefined, 'x'), 9000, 0.5, 0, 0)).toBe(0)
  })

  it('по высоте: выше линии + w/2 — полная сила, ниже линии − w/2 — ноль (экватор, равнина)', () => {
    expect(frostMask(on, 2100, 0, 0, 0)).toBe(1)
    expect(frostMask(on, 1900, 0, 0, 0)).toBe(0)
    expect(frostMask(on, 2000, 0, 0, 0)).toBeCloseTo(0.5, 12)
  })

  it('к полюсу линия опускается на drop·|sin φ|, в обоих полушариях', () => {
    expect(frostLine(on, 1, 0)).toBe(1000)
    expect(frostLine(on, -1, 0)).toBe(1000)
    expect(frostMask(on, 1100, 1, 0, 0)).toBe(1)
  })

  it('экспозиция: склон, обращённый к полюсу, опускает линию; от полюса — не поднимает; равнина — 0', () => {
    // северное полушарие; градиент вверх по склону на юг (0, −0.3) ⇒ склон смотрит на север, к полюсу
    expect(frostFacing(0, -0.3, 0.5)).toBeCloseTo(1, 12)
    expect(frostFacing(0, 0.3, 0.5)).toBeCloseTo(-1, 12)
    expect(frostFacing(0, 0, 0.5)).toBe(0)
    // южное полушарие: к полюсу — на юг
    expect(frostFacing(0, 0.3, -0.5)).toBeCloseTo(1, 12)
    expect(frostLine(on, 0, 1)).toBe(1700)
    expect(frostLine(on, 0, -1)).toBe(2000)
  })

  it('круче предела — иней не держится', () => {
    expect(frostMask(on, 9000, 0, 0.7, 0)).toBe(0)
    expect(frostMask(on, 9000, 0, 0.3, 0)).toBe(1)
  })

  it('переход по экспозиции и уклону — середины smoothstep', () => {
    // facing: slopeTan 0.05 — середина порога (0, 0.1)
    expect(frostFacing(0, -0.05, 0.5)).toBeCloseTo(0.5, 12)
    // высота насыщена (9000), slopeTan 0.51 — середина порога (0.42, 0.6)
    expect(frostMask(on, 9000, 0, 0.51, 0)).toBeCloseTo(0.5, 12)
    // facing +1 (склон смотрит к полюсу) ⇒ линия 1700, высота 1700 — середина по высоте;
    // slopeTan 0.3 < 0.42 — уклон ещё не гасит
    expect(frostMask(on, 1700, 0, 0, -0.3)).toBeCloseTo(0.5, 12)
  })
})

describe('Шейдер: иней', () => {
  const frag = PlanetShaderTemplate.fragmentShader
  const vert = PlanetShaderTemplate.vertexShader

  it('высота карты доступна под USE_TERRAIN_FROST в обоих шейдерах', () => {
    expect((vert.match(/defined\(USE_TERRAIN_MACRO_DETAIL\) \|\| defined\(USE_WATER_EDGE\) \|\| defined\(USE_TERRAIN_FROST\)/g) ?? []).length).toBe(2)
    expect(frag).toContain('#if defined(USE_TERRAIN_MACRO_DETAIL) || defined(USE_WATER_EDGE) || defined(USE_TERRAIN_FROST)')
  })

  it('маска как у зеркала; альбедо смешивается с цветом инея до света; окклюзия не тронута', () => {
    const start = frag.indexOf('vec3 surfaceAlbedo = diffuseSample * albedoMul;')
    const end = frag.indexOf('dayColor = surfaceAlbedo * mix(sunTintMix, lit, uTerrainLambert);')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = frag.slice(start, end)
    expect(block).toContain('float frostPole = frostSinLat >= 0.0 ? 1.0 : -1.0;')
    expect(block).toContain('float frostFacing = terrainSlopeTan > 1e-6 ? dot(-terrainMapSlopeVec / terrainSlopeTan, vec2(0.0, frostPole)) * smoothstep(0.0, 0.1, terrainSlopeTan) : 0.0;')
    expect(block).toContain('float frostLineH = uFrostLine.x - uFrostLine.z * abs(frostSinLat) - uFrostLine.w * max(frostFacing, 0.0);')
    expect(block).toContain(
      'float frostMask = uFrostStrength * smoothstep(frostLineH - 0.5 * uFrostLine.y, frostLineH + 0.5 * uFrostLine.y, vHeightMeters)\n' +
        '                          * (1.0 - smoothstep(0.7 * uFrostSlopeMax, uFrostSlopeMax, terrainSlopeTan));'
    )
    expect(block).toContain('surfaceAlbedo = mix(surfaceAlbedo, uFrostColor, frostMask);')
    expect(block).not.toContain('occlusion')
    expect(frag).not.toContain('dayColor = diffuseSample * albedoMul * mix(vec3(1.0), lit, uTerrainLambert);')
  })
})

// Гейт USE_TERRAIN_FROST: сетап скопирован с TerrainShadowWiring.spec (Луна,
// seedPlaceholderKeys/seedHeightMap) + slope-карта (frost требует USE_SLOPE,
// см. terrainMapSlopeVec). resolveFrostParams подменяется тем же приёмом
// vi.hoisted, что shadowOverride/waterLevelOverride — override поверх
// НАСТОЯЩЕГО резолвера (форма результата остаётся валидной FrostParams).
const frostOverride = vi.hoisted(() => ({ params: undefined as Partial<Record<string, unknown>> | undefined }))

vi.mock('@/core/terrain/frostParams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/terrain/frostParams')>()

  return {
    ...actual,
    resolveFrostParams: (data: Parameters<typeof actual.resolveFrostParams>[0], context: string) => {
      const params = actual.resolveFrostParams(data, context)

      return frostOverride.params === undefined ? params : { ...params, ...frostOverride.params }
    }
  }
})

const MOON_ID = 19
const MOON_HEIGHT_PATH = 'planets/moon/moon_height.raw'

function moon(): Actor {
  return Actor.find(MOON_ID)!
}

function moonPathOf(kind: ResourceType): string {
  return moon().resources.where('resourceType', kind).first()!.getAttribute('path') as string
}

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moonPathOf('diffuse'))
}

function seedHeightMap(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(MOON_HEIGHT_PATH, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

describe('PlanetMaterial: гейт инея', () => {
  beforeEach(() => {
    seedPlaceholderKeys()
    seedHeightMap()
    seedTexture(moonPathOf('slope'), 8192, 4096)
  })

  afterEach(() => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
    frostOverride.params = undefined
  })

  it('Луна по умолчанию: frostStrength 0 — дефайна нет', () => {
    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_FROST).toBeUndefined()
  })

  it('frostStrength 0.8 (подмена резолвера): дефайн есть, юниформы доезжают', () => {
    frostOverride.params = {
      frostStrength: 0.8,
      frostLineMeters: 2000,
      frostLineWidthMeters: 200,
      frostPolarDropMeters: 1000,
      frostAspectMeters: 300
    }

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_FROST).toBe('1')
    expect(material.uniforms.uFrostStrength.value).toBe(0.8)
    expect(material.uniforms.uFrostLine.value).toEqual({ x: 2000, y: 200, z: 1000, w: 300 })
    expect((material.uniforms.uFrostColor.value as Color).equals(new Color(0xf0f2f5))).toBe(true)
  })

  it('без slope-карты — дефайна нет, даже при frostStrength > 0', () => {
    resourceStorage.deleteTexture(moonPathOf('slope'))
    frostOverride.params = { frostStrength: 0.8 }

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_FROST).toBeUndefined()
  })
})
