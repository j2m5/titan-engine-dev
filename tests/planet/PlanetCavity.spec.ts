import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { Texture } from 'three'
import { Resources } from '@storage/database/resources'
import { ActorResource } from '@storage/database/actorResource'
import { RenderingObjects } from '@storage/database/renderingObjects'

// Строковые ассерты терраформной ветки шаблона — контракт Task 1 (report):
// канал B декодится (byte-128)/127 БЕЗ множителя SLOPE_RANGE, знак «плюс —
// гребень, светлит».
describe('PlanetShaderTemplate: декод cavity-канала (строковые ассерты)', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader

  it('юниформ uCavityStrength объявлен', () => {
    expect(frag).toContain('uniform float uCavityStrength;')
  })

  it('декод под USE_CAVITY, второй texture2D по тому же uv, без множителя SLOPE_RANGE', () => {
    expect(frag).toContain('#ifdef USE_CAVITY')
    expect(frag).toContain('texture2D(bumpMap, uv).z * 255.0 - 128.0) / 127.0')
  })

  it('множитель альбедо: clamp(1.0 + uCavityStrength * cavity, 0.0, 2.0)', () => {
    expect(frag).toContain('albedoMul *= clamp(1.0 + uCavityStrength * cavity, 0.0, 2.0);')
  })

  it('выборка cavity стоит ПОСЛЕ perturbNormalFromSlope и ДО applyTerrainDetail', () => {
    const slopeIdx = frag.indexOf('perturbNormalFromSlope(nLocal, eastLocal, uv)')
    const cavityIdx = frag.indexOf('#ifdef USE_CAVITY')
    const detailIdx = frag.indexOf('applyTerrainDetail(')

    expect(slopeIdx).toBeGreaterThan(-1)
    expect(cavityIdx).toBeGreaterThan(slopeIdx)
    expect(detailIdx).toBeGreaterThan(cavityIdx)
  })
})

// Страж знака: JS-зеркало формулы декода, зафиксированной строкой в тесте
// выше (`texture2D(bumpMap, uv).z * 255.0 - 128.0) / 127.0`) и в шаблоне.
// Байты — из Task 1 (report): cavity=-1 -> байт 1, cavity=+1 -> байт 255,
// cavity=0 -> байт 128 (границы кодировщика, без неопределённости дизера).
describe('Cavity decode: числовой страж знака', () => {
  // b — нормализованный семпл текстуры [0,1] (WebGL текстуры отдают floats),
  // *255 восстанавливает исходный байт — та же арифметика, что в шаблоне.
  function decodeCavity(byteValue: number): number {
    const b = byteValue / 255

    return (b * 255 - 128) / 127
  }

  function cavityMultiplier(byteValue: number, cavityStrength: number): number {
    const cavity = decodeCavity(byteValue)

    return Math.min(2.0, Math.max(0.0, 1.0 + cavityStrength * cavity))
  }

  it('байт ямы (1) даёт множитель меньше 1', () => {
    expect(cavityMultiplier(1, 1)).toBeLessThan(1)
  })

  it('байт гребня (255) даёт множитель больше 1', () => {
    expect(cavityMultiplier(255, 1)).toBeGreaterThan(1)
  })

  it('байт 128 (нейтраль) даёт множитель ровно 1', () => {
    expect(cavityMultiplier(128, 1)).toBe(1)
  })

  it('декод НЕ домножает на SLOPE_RANGE (в отличие от R/G) — байт 255 даёт cavity=1, не SLOPE_RANGE', () => {
    expect(decodeCavity(255)).toBeCloseTo(1, 10)
    expect(decodeCavity(1)).toBeCloseTo(-1, 10)
  })
})

// Проводка PlanetMaterial: гейт USE_CAVITY и юниформ uCavityStrength.
// Тела БД (Луна и т.п.) не несут ручку cavityStrength (Task 3) — для
// сценариев с ненулевой ручкой актор стабится локально (образец —
// AtmosphereKneeWiring.spec.ts / TerrainFloorWiring.spec.ts).
const HEIGHT_PATH = 'stub/cavity/height.raw'
const SLOPE_PATH = 'stub/cavity/slope.webp'
const DIFFUSE_PATH = 'stub/cavity/diffuse.png'

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
  seedTexture(DIFFUSE_PATH)
}

function seedHeightField(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(HEIGHT_PATH, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

interface StubOptions {
  data: Record<string, unknown>
  slopeResource?: boolean
}

function stubActor({ data, slopeResource = true }: StubOptions): Actor {
  const pathByType: Record<string, string> = {
    diffuse: DIFFUSE_PATH,
    height: HEIGHT_PATH,
    ...(slopeResource ? { slope: SLOPE_PATH } : {})
  }

  return {
    renderingObject: { getAttribute: () => data },
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

describe('PlanetMaterial: проводка cavity (гейт USE_CAVITY, юниформ uCavityStrength)', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
  })

  it('slope готова, cavityStrength отсутствует в data — USE_CAVITY не ставится, юниформ 0', () => {
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)

    const material = new PlanetMaterial(stubActor({ data: {} }))
    material.updateMaterial()

    expect(material.defines.USE_CAVITY).toBeUndefined()
    expect(material.uniforms.uCavityStrength.value).toBe(0)
  })

  it('slope готова, cavityStrength=0 явно — USE_CAVITY не ставится', () => {
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)

    const material = new PlanetMaterial(stubActor({ data: { cavityStrength: 0 } }))
    material.updateMaterial()

    expect(material.defines.USE_CAVITY).toBeUndefined()
    expect(material.uniforms.uCavityStrength.value).toBe(0)
  })

  it('slope готова, cavityStrength>0 — USE_CAVITY ставится, юниформ доезжает из data', () => {
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)

    const material = new PlanetMaterial(stubActor({ data: { cavityStrength: 0.6 } }))
    material.updateMaterial()

    expect(material.defines.USE_CAVITY).toBe('1')
    expect(material.uniforms.uCavityStrength.value).toBe(0.6)
  })

  it('карта высот не загружена — USE_CAVITY не ставится даже при cavityStrength>0 (slope-путь недоступен)', () => {
    seedTexture(SLOPE_PATH, 8, 4) // heightField НЕ сеется

    const material = new PlanetMaterial(stubActor({ data: { cavityStrength: 0.6 } }))
    material.updateMaterial()

    expect(material.defines.USE_CAVITY).toBeUndefined()
    // юниформ форвардится из data независимо от гейта
    expect(material.uniforms.uCavityStrength.value).toBe(0.6)
  })

  it('slope-текстура ещё не пришла из стримера — USE_CAVITY не ставится даже при cavityStrength>0', () => {
    seedHeightField() // slope-текстура НЕ сеется (ресурс есть, стример не догрузил)

    const material = new PlanetMaterial(stubActor({ data: { cavityStrength: 0.6 } }))
    material.updateMaterial()

    expect(material.defines.USE_CAVITY).toBeUndefined()
  })

  it('slope-ресурса у тела нет вовсе — USE_CAVITY не ставится даже при cavityStrength>0', () => {
    seedHeightField()

    const material = new PlanetMaterial(stubActor({ data: { cavityStrength: 0.6 }, slopeResource: false }))
    material.updateMaterial()

    expect(material.defines.USE_CAVITY).toBeUndefined()
  })

  it('resetMaterial снимает USE_CAVITY и возвращает юниформ в 0', () => {
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)

    const material = new PlanetMaterial(stubActor({ data: { cavityStrength: 0.6 } }))
    material.updateMaterial()
    expect(material.defines.USE_CAVITY).toBe('1')

    material.resetMaterial()

    expect(material.defines.USE_CAVITY).toBeUndefined()
    expect(material.uniforms.uCavityStrength.value).toBe(0)
  })

  it('при нулевой ручке путь бит-в-бит текущим: без USE_CAVITY дефайнов ровно как без cavity вовсе', () => {
    seedHeightField()
    seedTexture(SLOPE_PATH, 8, 4)

    const withoutField = new PlanetMaterial(stubActor({ data: {} }))
    withoutField.updateMaterial()

    const withZero = new PlanetMaterial(stubActor({ data: { cavityStrength: 0 } }))
    withZero.updateMaterial()

    expect(withoutField.defines).toEqual(withZero.defines)
  })
})

// Счётный инвариант данных (Task 3): охват выводится ПРОГРАММНО из БД —
// акторы с height-ресурсом (путь заканчивается на _height.raw), минус
// фотомозаичные {5, 6, 8, 19} (Меркурий, Венера, Марс, Луна — реальные DEM,
// cavity им не полагается). Ожидание — ровно 44 тела.
describe('Счётный инвариант: cavityStrength у 44 терраформных тел (Task 3)', () => {
  const PHOTOMOSAIC_ACTOR_IDS: readonly number[] = [5, 6, 8, 19]

  const heightActorIds = new Set(
    ActorResource.filter((ar) => {
      const resource = Resources.find((r) => r.id === ar.resourceId)

      return resource?.resourceType === 'height' && resource.path.endsWith('_height.raw')
    }).map((ar) => ar.actorId)
  )

  const coverageActorIds = [...heightActorIds].filter((id) => !PHOTOMOSAIC_ACTOR_IDS.includes(id))

  it('охват — ровно 44 тела', () => {
    expect(coverageActorIds.length).toBe(44)
  })

  it('у всех 44 тел охвата data.cavityStrength > 0', () => {
    for (const actorId of coverageActorIds) {
      const renderingObject = RenderingObjects.find((ro) => ro.actorId === actorId)

      expect(renderingObject, `нет renderingObject для actorId ${actorId}`).toBeDefined()

      const data = renderingObject!.data as { cavityStrength?: number }

      expect(data.cavityStrength, `actorId ${actorId}: cavityStrength`).toBeGreaterThan(0)
    }
  })

  it('у фотомозаичных тел {5, 6, 8, 19} поля cavityStrength нет', () => {
    for (const actorId of PHOTOMOSAIC_ACTOR_IDS) {
      const renderingObject = RenderingObjects.find((ro) => ro.actorId === actorId)

      expect(renderingObject, `нет renderingObject для actorId ${actorId}`).toBeDefined()

      const data = renderingObject!.data as { cavityStrength?: number }

      expect(data.cavityStrength, `actorId ${actorId}: cavityStrength должен отсутствовать`).toBeUndefined()
    }
  })

  // Фикс-волна финального ревью, находка 4: прежние два теста выше проверяют
  // ручку ТОЛЬКО на множестве, выведенном из heightActorIds — лишняя ручка на
  // теле ВНЕ этого множества (гигант, Земля, Явин IV — легаси-материал, никогда
  // не несёт height-ресурс с суффиксом _height.raw) прошла бы обоими зелёной.
  // Этот тест считает cavityStrength>0 по ВСЕЙ таблице RenderingObjects
  // напрямую — единственный, кто ловит лишнюю ручку у тела вне охвата.
  // Дискриминация подтверждена мутацией (руками, не в этом файле): временная
  // строка cavityStrength: 0.35 у Нептуна (renderingObjects id 4, actorId 13,
  // легаси-bump гигант) дала RED только на этом тесте, была отменена.
  it('ровно 44 строки RenderingObjects несут cavityStrength (не только заявленный охват)', () => {
    const withCavity = RenderingObjects.filter((ro) => {
      const data = ro.data as { cavityStrength?: number }

      return typeof data.cavityStrength === 'number' && data.cavityStrength > 0
    })

    expect(withCavity.length).toBe(44)
  })
})
