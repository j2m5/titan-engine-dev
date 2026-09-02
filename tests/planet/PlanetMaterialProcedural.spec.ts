import { afterEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { proceduralDiffuseKey } from '@/core/services/ProceduralSurfaceGenerator'
import type { ProceduralSurfaceGenerator } from '@/core/services/ProceduralSurfaceGenerator'
import { assertProceduralWiring } from '@/core/renderables/TerrainSphere'
import { Actor } from '@/core/models/Actor'
import { ResourceType } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { ProceduralSurfaceParams } from '@/core/terrain/proceduralSurfaceParams'

const VALID_PARAMS: ProceduralSurfaceParams = {
  seed: 931,
  frequencyPerRadius: 3,
  octaves: 6,
  gain: 0.5,
  lacunarity: 2,
  contrast: 1.3,
  palette: ['#1c1414', '#4a241d', '#7a3b28', '#a8683f'],
  albedoNoise: 0.35
}

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

/**
 * Конструктор PlanetShader ходит через getTextureOrMake за 'default.png',
 * 'night.jpg' и '' (заглушка кольца) — промах строит PlaceholderTexture на
 * канвасе, которого в jsdom нет (тот же приём, что GiantDetailWiring.spec.ts).
 */
function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg']) seedTexture(name)
}

/**
 * Фикстурный актор без похода в реальную БД: у актора 93 (Korriban I)
 * proceduralSurface появится только Task 6 (см. РУЛИНГ префлайта T4/T6 —
 * порядок задач 1..8 сохраняем, тест не ждёт данных). Приём — тот же, что
 * stubActor в GiantDetailWiring.spec.ts/ProceduralSurfaceGenerator.spec.ts:
 * подменяем геттеры-связи плоским объектом, а не мокаем весь database-модуль.
 */
function stubActor(
  id: number,
  radiusKm: number,
  data: Record<string, unknown>,
  pathByType: Record<string, string> = {}
): Actor {
  return {
    getAttribute: (key: string, fallback?: unknown): unknown => {
      if (key === 'id') return id
      if (key === 'name') return `Stub ${id}`
      return fallback
    },
    renderingObject: { getAttribute: (key: string): unknown => (key === 'data' ? { emission: 1, ...data } : undefined) },
    physicalObject: { getAttribute: (key: string): unknown => (key === 'radius' ? radiusKm : undefined) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: {
      where: (_field: string, type: string) => ({
        first: () => {
          const path = pathByType[type]

          return path === undefined ? undefined : { getAttribute: () => path }
        }
      })
    }
  } as unknown as Actor
}

// Луна (actorId 19) — тело без proceduralSurface, пин прежнего поведения: диффуз из ресурса.
function moon(): Actor {
  return Actor.find(19)!
}

function moonPathOf(kind: ResourceType): string {
  return moon().resources.where('resourceType', kind).first()!.getAttribute('path') as string
}

describe('PlanetMaterial: диффуз процедурного тела', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  it('тело с data.proceduralSurface резолвит диффуз по proceduralDiffuseKey, а не по ресурсу', () => {
    seedPlaceholderKeys()
    const key = proceduralDiffuseKey(93)
    // Текстуру кладёт ProceduralSurfaceGenerator.ensureDiffuse (Task 4) — здесь,
    // как в её собственном спеке, регистрируем руками под тем же ключом.
    seedTexture(key)

    const actor = stubActor(93, 1740, { proceduralSurface: VALID_PARAMS })
    const material = new PlanetMaterial(actor)
    material.updateMaterial()

    expect(material.uniforms.diffuseMap.value.name).toBe(key)
  })

  it('тело БЕЗ proceduralSurface — прежнее поведение: диффуз из ресурса (пин на Луне)', () => {
    seedPlaceholderKeys()
    seedTexture(moonPathOf('diffuse'))

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.uniforms.diffuseMap.value.name).toBe(moonPathOf('diffuse'))
  })
})

describe('TerrainSphere.assertProceduralWiring: fail-fast на разрыв DI-цепочки', () => {
  it('proceduralSurface есть, генератор НЕ передан — throw с именем тела и подсказкой по токену', () => {
    const actor = stubActor(93, 1740, { proceduralSurface: VALID_PARAMS })

    expect(() => assertProceduralWiring(actor, undefined)).toThrow(/ProceduralSurfaceGenerator/)
    expect(() => assertProceduralWiring(actor, undefined)).toThrow(/Stub 93/)
  })

  it('proceduralSurface есть, генератор передан — не бросает', () => {
    const actor = stubActor(93, 1740, { proceduralSurface: VALID_PARAMS })
    const generator = {} as unknown as ProceduralSurfaceGenerator

    expect(() => assertProceduralWiring(actor, generator)).not.toThrow()
  })

  it('proceduralSurface нет, генератор не передан — норма (легаси-тела/тесты)', () => {
    const actor = stubActor(19, 1737, {})

    expect(() => assertProceduralWiring(actor, undefined)).not.toThrow()
  })
})
