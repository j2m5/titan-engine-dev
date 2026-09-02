import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { Actor } from '@/core/models/Actor'
import { ResourceType } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { validateProceduralSurface } from '@/core/terrain/proceduralSurfaceParams'
import { ClampToEdgeWrapping, RepeatWrapping, Texture } from 'three'

// Земля (actorId 7) — единственное тело с полным набором карт
function earth(): Actor {
  return Actor.find(7)!
}

function pathOf(kind: ResourceType): string {
  return earth().resources.where('resourceType', kind).first()!.getAttribute('path') as string
}

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

/**
 * `getTextureOrMake` при промахе строит PlaceholderTexture, а тот рисует на
 * канвасе — в jsdom `getContext('2d')` возвращает null, и конструктор материала
 * падает. Поэтому сеем все ключи, по которым материал ходит через
 * `getTextureOrMake`: диффуз тела, 'default.png', 'night.jpg' и пустую строку
 * (её подставляет `?? ''` там, где ресурса нет — например текстура колец у
 * Земли).
 */
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(pathOf('diffuse'))
}

// Классический bump-путь (USE_BUMP) и его стаб legacyBumpActor удалены вместе
// с типом ресурса bump: планетного носителя у него не осталось, тело без карты
// высот рендерится гладкой сферой с одним диффузом.

// Луна (actorId 19) — тело с height-ресурсом: рельеф в геометрии, шейдинг из slope-карты
function moon(): Actor {
  return Actor.find(19)!
}

function moonPathOf(kind: ResourceType): string {
  return moon().resources.where('resourceType', kind).first()!.getAttribute('path') as string
}

// содержимое не важно: материал спрашивает только факт наличия карты в реестре
function seedMoonHeightMap(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(moonPathOf('height'), {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

describe('PlanetMaterial: slope-карта у тел с честным рельефом', () => {
  beforeEach(() => {
    seedPlaceholderKeys()
    seedTexture(moonPathOf('diffuse'))
  })
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
  })

  it('slope-ресурс тела с загруженной картой высот включает USE_SLOPE', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('slope'), 8192, 4096)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_SLOPE).toBe('1')
    expect(material.uniforms.bumpMap.value).not.toBeNull()
  })

  it('частичный набор карт задачи 2 — диффуз и slope есть, detail нет: материал живёт, USE_TERRAIN_DETAIL молчит', () => {
    // ResourceObserver (задача 2) грузит пути НЕЗАВИСИМО: тело показывает
    // диффуз+рельеф раньше, чем догрузится опциональный детальный слой (или
    // если тот вообще проиграл бюджету). Материал обязан пережить такой
    // частичный набор без брошенных исключений и без лишних дефайнов —
    // detail-текстуры здесь НЕ сеются вовсе.
    seedMoonHeightMap()
    seedTexture(moonPathOf('slope'), 8192, 4096)

    const material = new PlanetMaterial(moon())

    expect(() => material.updateMaterial()).not.toThrow()

    // Тело живо: диффуз и рельеф на месте.
    expect(material.uniforms.diffuseMap.value).toBeDefined()
    expect(material.defines.USE_SLOPE).toBe('1')

    // Детального слоя нет — ни юниформов, ни дефайна.
    expect(material.defines.USE_TERRAIN_DETAIL).toBeUndefined()
    expect(material.uniforms.uDetailNorMap.value).toBeNull()
    expect(material.uniforms.uDetailDiffMap.value).toBeNull()
    expect(material.uniforms.uDetailArmMap.value).toBeNull()
    expect(material.uniforms.uDetailNor2Map.value).toBeNull()
  })

  it('пока slope-текстура не пришла из стримера, дефайны рельефа молчат', () => {
    seedMoonHeightMap()

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_SLOPE).toBeUndefined()
    expect(material.defines.USE_BUMP).toBeUndefined()
  })

  it('карта высот не загрузилась — кратерный шейдинг на гладкой сфере не включается', () => {
    // геометрия в этом случае легаси-гладкая (Planet сверяется с тем же
    // реестром): USE_SLOPE рисовал бы рельеф, которого нет в силуэте
    seedTexture(moonPathOf('slope'), 8192, 4096)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_SLOPE).toBeUndefined()
    expect(material.defines.USE_BUMP).toBeUndefined()
  })

  it('resetMaterial снимает USE_SLOPE', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('slope'), 8192, 4096)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()
    expect(material.defines.USE_SLOPE).toBe('1')

    material.resetMaterial()

    expect(material.defines.USE_SLOPE).toBeUndefined()
  })

  it('slope ушла из реестра — USE_SLOPE снимается следующим updateMaterial, а не врёт поверх', () => {
    // Сценарий стримера: бюджет вытеснил slope тела, позже догрузился ЛЮБОЙ
    // другой путь этого актора (или шаренная detail-текстура — она дёргает
    // updateMaterial у всех совладельцев) — и материал пересобирается уже без
    // slope. Дефайн, переживший вытеснение, оставил бы включённым код, которому
    // three подставит пустую чёрную текстуру: декод в SlopeNormal прочитает из
    // неё (0-128)*2/127 = -2.016 по обоим каналам, и тело зашейдится нормалью,
    // отклонённой примерно на 70° — видимая катастрофа вместо тихой деградации.
    seedMoonHeightMap()
    seedTexture(moonPathOf('slope'), 8192, 4096)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()
    expect(material.defines.USE_SLOPE).toBe('1')

    resourceStorage.deleteTexture(moonPathOf('slope'))
    material.updateMaterial()

    expect(material.defines.USE_SLOPE).toBeUndefined()
    expect(material.uniforms.bumpMap.value).toBeUndefined()
  })

  it('detail-нормаль ушла из реестра — USE_TERRAIN_DETAIL снимается следующим updateMaterial', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('slope'), 8192, 4096)
    seedTexture(moonPathOf('detailNormal'), 2048, 2048)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()
    expect(material.defines.USE_TERRAIN_DETAIL).toBe('1')

    resourceStorage.deleteTexture(moonPathOf('detailNormal'))
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_DETAIL).toBeUndefined()
    expect(material.uniforms.uDetailNorMap.value).toBeNull()
  })

  // Миграция: wrap больше не ставит updateMaterial мутацией — он приходит из
  // данных строки ресурса (загрузчик применяет их через applyTextureParameters).
  it('wrap задаётся данными ресурса, updateMaterial текстуры не мутирует', () => {
    seedMoonHeightMap()
    // сеем текстуру с дефолтным ClampToEdge — как её отдал бы загрузчик БЕЗ параметров строки
    seedTexture(moonPathOf('slope'), 8192, 4096)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    // материал больше НЕ переписывает wrap (раньше ставил RepeatWrapping принудительно)
    expect((material.uniforms.bumpMap.value as Texture).wrapS).toBe(ClampToEdgeWrapping)
  })

  it('конструкторные дефайны переживают пересборку: USE_RING жив после update и reset', () => {
    // Дефайны собираются с нуля из снимка конструктора, а не накапливаются
    // поверх прошлых. Снимок обязан нести то, что поставил PlanetShader
    // (тень колец), иначе Сатурн терял бы кольца на первом обновлении карт.
    const saturn = Actor.find(11)!
    seedTexture(saturn.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
    // текстура колец идёт через getTextureOrMake — без посева PlaceholderTexture
    // полезет рисовать на канвасе, которого в jsdom нет (см. seedPlaceholderKeys)
    seedTexture(saturn.children.where('categoryId', 6).first()!.resources.first()!.getAttribute('path') as string)

    const material = new PlanetMaterial(saturn)
    expect(material.defines.USE_RING).toBe('1')

    material.updateMaterial()
    expect(material.defines.USE_RING).toBe('1')

    material.resetMaterial()
    expect(material.defines.USE_RING).toBe('1')
  })

  it('строки диффуза и slope Луны несут wrapS: RepeatWrapping в данных', () => {
    const diffuse = moon().resources.where('resourceType', 'diffuse').first()!
    const slope = moon().resources.where('resourceType', 'slope').first()!
    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
    expect(slope.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-строки Луны: четыре типа, streamable, repeat по обеим осям', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const row = moon().resources.where('resourceType', type).first()
      expect(row, type).toBeDefined()
      expect(row!.getAttribute('lifecycle')).toBe('streamable')
      expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
      expect(row!.getAttribute('wrapT')).toBe(RepeatWrapping)
    }
  })

  it('detail-текстуры Луны: updateMaterial не переписывает wrap (та же миграция, что у slope)', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('detailNormal'), 8, 4)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect((material.uniforms.uDetailNorMap.value as Texture).wrapS).toBe(ClampToEdgeWrapping)
  })

  it('у тела без карты высот wrap текстур не меняется', () => {
    const STUB_DIFFUSE_PATH = 'stub/plain/diffuse.png'
    seedTexture(STUB_DIFFUSE_PATH)

    // Минимальный актор без карты высот (образец stubActor из PlanetCavity.spec.ts)
    const stub = {
      renderingObject: { getAttribute: () => ({ emission: 1 }) },
      children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
      resources: {
        where: (_field: string, type: string) => ({
          first: () => (type === 'diffuse' ? { getAttribute: () => STUB_DIFFUSE_PATH } : undefined)
        })
      }
    } as unknown as Actor

    const material = new PlanetMaterial(stub)
    material.updateMaterial()

    expect((material.uniforms.diffuseMap.value as Texture).wrapS).toBe(ClampToEdgeWrapping)
  })

  it('USE_TERRAIN_UV ставится по факту загруженной карты высот — независимо от slope-текстуры', () => {
    seedMoonHeightMap()

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_UV).toBe('1')
  })

  it('у тела без карты высот USE_TERRAIN_UV не ставится', () => {
    const material = new PlanetMaterial(earth())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_UV).toBeUndefined()
  })

  it('resetMaterial снимает USE_TERRAIN_UV', () => {
    seedMoonHeightMap()

    const material = new PlanetMaterial(moon())
    material.updateMaterial()
    expect(material.defines.USE_TERRAIN_UV).toBe('1')

    material.resetMaterial()

    expect(material.defines.USE_TERRAIN_UV).toBeUndefined()
  })
})

// Каллисто (actorId 23) — второе тело с честным рельефом (терраформная арка
// synth-heightmap): height/slope из оффлайн-генератора, детальные текстуры
// делятся по пути с Луной (общие terrain/*.webp, шаринг ресурсов по id)
/** Детальная тройка тела = один архетип (terrain/<archetype>_*), мелкая нормаль — общая с Луной (ресурс 129). */
function expectArchetypeDetailSet(actor: Actor, archetype: 'ice' | 'sand' | 'volcanic'): void {
  const expectedPaths = {
    detailDiffuse: `terrain/${archetype}_diff.webp`,
    detailNormal: `terrain/${archetype}_nor.webp`,
    detailArm: `terrain/${archetype}_arm.webp`
  } as const

  for (const type of Object.keys(expectedPaths) as (keyof typeof expectedPaths)[]) {
    const row = actor.resources.where('resourceType', type).first()

    expect(row, type).toBeDefined()
    expect(row!.getAttribute('path')).toBe(expectedPaths[type])
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
    expect(row!.getAttribute('wrapT')).toBe(RepeatWrapping)
  }

  const moonMicro = moon().resources.where('resourceType', 'detailNormal2').first()!
  const micro = actor.resources.where('resourceType', 'detailNormal2').first()!
  expect(micro.getAttribute('id')).toBe(moonMicro.getAttribute('id'))
}

function callisto(): Actor {
  return Actor.find(23)!
}

describe('PlanetMaterial: данные Каллисто — height/slope/detail-связки и ручки детального слоя', () => {
  it('height-строка Каллисто: верный путь и резидентный lifecycle', () => {
    const row = callisto().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/callisto/callisto_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Каллисто: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = callisto().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/callisto/callisto_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('диффуз Каллисто несёт wrapS: RepeatWrapping в данных (терраформный шов меридиана)', () => {
    const diffuse = callisto().resources.where('resourceType', 'diffuse').first()!

    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-тройка Каллисто — ледяной архетип terrain/ice_* (тёмный лёд), мелкая нормаль общая с Луной', () => {
    expectArchetypeDetailSet(callisto(), 'ice')
  })

  it('renderingObjects Каллисто несёт ручки детального слоя террейна', () => {
    const data = callisto().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.1)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
  })
})

// Европа (actorId 21) — третье тело с честным рельефом (терраформная арка
// synth-heightmap): height/slope из оффлайн-генератора, детальные текстуры
// делятся по пути с Луной и Каллисто (общие terrain/*.webp, шаринг ресурсов по id)
function europa(): Actor {
  return Actor.find(21)!
}

describe('PlanetMaterial: данные Европы — height/slope/detail-связки и ручки детального слоя', () => {
  it('height-строка Европы: верный путь и резидентный lifecycle', () => {
    const row = europa().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/europa/europa_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Европы: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = europa().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/europa/europa_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('диффуз Европы несёт wrapS: RepeatWrapping в данных (терраформный шов меридиана)', () => {
    const diffuse = europa().resources.where('resourceType', 'diffuse').first()!

    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-тройка Европы — ледяной архетип terrain/ice_*, мелкая нормаль общая с Луной', () => {
    expectArchetypeDetailSet(europa(), 'ice')
  })

  it('renderingObjects Европы несёт ручки детального слоя террейна', () => {
    const data = europa().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.1)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
  })
})

// Рея (actorId 28, корзина A) — часть батча 18 спутников (терраформная арка synth-heightmap,
// оркестратор scripts/batch-synth-heightmaps.ts)
function rhea(): Actor {
  return Actor.find(28)!
}

describe('PlanetMaterial: данные Реи — height/slope/detail-связки и ручки детального слоя', () => {
  it('height-строка Реи: верный путь и резидентный lifecycle', () => {
    const row = rhea().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/rhea/rhea_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Реи: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = rhea().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/rhea/rhea_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('диффуз Реи несёт wrapS: RepeatWrapping в данных (терраформный шов меридиана)', () => {
    const diffuse = rhea().resources.where('resourceType', 'diffuse').first()!

    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-тройка Реи — ледяной архетип terrain/ice_*, мелкая нормаль общая с Луной', () => {
    expectArchetypeDetailSet(rhea(), 'ice')
  })

  it('renderingObjects Реи несёт ручки детального слоя террейна', () => {
    const data = rhea().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.1)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
  })
})

// Ио (actorId 20, корзина B) — часть батча 18 спутников; detailSaturation 0.15 (как у Луны),
// у остальных 17 тел батча — 0.1
function io(): Actor {
  return Actor.find(20)!
}

describe('PlanetMaterial: данные Ио — height/slope/detail-связки и ручки детального слоя', () => {
  it('height-строка Ио: верный путь и резидентный lifecycle', () => {
    const row = io().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/io/io_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Ио: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = io().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/io/io_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('диффуз Ио несёт wrapS: RepeatWrapping в данных (терраформный шов меридиана)', () => {
    const diffuse = io().resources.where('resourceType', 'diffuse').first()!

    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-тройка Ио — вулканический архетип terrain/volcanic_* (пилот приёмки), мелкая нормаль общая с Луной', () => {
    expectArchetypeDetailSet(io(), 'volcanic')
  })

  it('renderingObjects Ио несёт ручки детального слоя террейна (detailSaturation 0.15 — как у Луны)', () => {
    const data = io().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.15)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
  })
})

// Тела батча (терраформная арка synth-heightmap): 12+6 генераций (фикс-раунд 1 Task 4
// перевёл Корribан I-VII на пер-тело height/slope — общая карта, откалиброванная под радиус I,
// давала VII 577% его бюджета высоты) — счётные инварианты одинаковы для всех.
// Явин IV (83) возвращён в список аркой воды (Task 6) — хотфикс 2026-08-17,
// временно выводивший его на легаси, исполнил своё условие (вода готова).
// Корribан I-VII (93-99) ИЗ этого списка снова УБРАНЫ отдельной аркой Task 6
// (процедурная поверхность): диффуз-ресурс 117 у них снят, диффуз рендерится
// рантайм-генератором из proceduralSurface — инвариант «диффуз есть» этого
// describe им больше не подходит, свой страж — PROCEDURAL_ACTOR_IDS ниже.
const BATCH_ACTOR_IDS = [20, 22, 28, 29, 30, 36, 37, 38, 73, 83, 70] as const
const TERRAFORM_RESOURCE_TYPES = ['height', 'slope', 'detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const

describe(`PlanetMaterial: счётные инварианты батча ${BATCH_ACTOR_IDS.length} спутников`, () => {
  it.each(BATCH_ACTOR_IDS)('actorId %i: пара height+slope, wrapS у slope и диффуза, bumpScale 1, ровно 6 терраформных связок', (actorId) => {
    const actor = Actor.find(actorId)!
    const height = actor.resources.where('resourceType', 'height').first()
    const slope = actor.resources.where('resourceType', 'slope').first()
    const diffuse = actor.resources.where('resourceType', 'diffuse').first()

    expect(height, `actorId ${actorId}: height`).toBeDefined()
    expect(slope, `actorId ${actorId}: slope`).toBeDefined()
    expect(slope!.getAttribute('wrapS'), `actorId ${actorId}: slope wrapS`).toBe(RepeatWrapping)
    expect(diffuse!.getAttribute('wrapS'), `actorId ${actorId}: diffuse wrapS`).toBe(RepeatWrapping)

    const data = actor.renderingObject!.getAttribute('data') as Record<string, unknown>
    expect(data.bumpScale, `actorId ${actorId}: bumpScale`).toBe(1)

    const terraformLinks = actor.resources.whereIn('resourceType', [...TERRAFORM_RESOURCE_TYPES]).count()
    expect(terraformLinks, `actorId ${actorId}: терраформные связки`).toBe(6)
  })

  it('у Корribан-тел (93-99) РАЗНЫЕ resourceId height/slope — общей карты больше нет', () => {
    const korribanActorIds = [93, 94, 95, 96, 97, 98, 99] as const
    const heightIds = korribanActorIds.map(
      (actorId) => Actor.find(actorId)!.resources.where('resourceType', 'height').first()!.getAttribute('id')
    )
    const slopeIds = korribanActorIds.map(
      (actorId) => Actor.find(actorId)!.resources.where('resourceType', 'slope').first()!.getAttribute('id')
    )

    expect(new Set(heightIds).size, 'height resourceId должны быть уникальны').toBe(korribanActorIds.length)
    expect(new Set(slopeIds).size, 'slope resourceId должны быть уникальны').toBe(korribanActorIds.length)
  })
})

// Луны Коррибана (actorId 93-99, Task 6 арки «процедурная поверхность»):
// диффуз больше не файловый ресурс — его рендерит ProceduralSurfaceGenerator
// из data.proceduralSurface (Task 4/5), а данные тела несут только сид+ручки
// fBM-поля. height/slope — как у остального батча (пер-тело, задача 4 прошлой
// арки), общий шаренный диффуз (ресурс 117) снят вместе со связками.
const PROCEDURAL_ACTOR_IDS = [93, 94, 95, 96, 97, 98, 99] as const

describe('PlanetMaterial: процедурные тела (луны Коррибана)', () => {
  it.each(PROCEDURAL_ACTOR_IDS)('actorId %i: proceduralSurface валиден, diffuse-ресурса нет, height+slope есть, slope repeat, bumpScale 1, ровно 4 детальные связки', (actorId) => {
    const actor = Actor.find(actorId)!
    const data = actor.renderingObject!.getAttribute('data') as Record<string, unknown>
    expect(() => validateProceduralSurface(data.proceduralSurface, String(actorId))).not.toThrow()
    expect(actor.resources.where('resourceType', 'diffuse').count()).toBe(0)
    expect(actor.resources.where('resourceType', 'height').count()).toBe(1)
    expect(actor.resources.where('resourceType', 'slope').count()).toBe(1)

    const slope = actor.resources.where('resourceType', 'slope').first()!
    expect(slope.getAttribute('wrapS'), `actorId ${actorId}: slope wrapS`).toBe(RepeatWrapping)
    expect(data.bumpScale, `actorId ${actorId}: bumpScale`).toBe(1)

    // 4 детальные связки — терраформная шестёрка минус height+slope, которые
    // уже проверены выше отдельно (страж компенсации 93-99: диффуз тела
    // генерируется рантаймом, но детальный слой всё равно файловый).
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      expect(actor.resources.where('resourceType', type).count(), `actorId ${actorId}: ${type}`).toBe(1)
    }
  })

  it('терраформные тела БЕЗ proceduralSurface по-прежнему несут diffuse-ресурс', () => {
    for (const actorId of [19, 8, 25]) {
      expect(Actor.find(actorId)!.resources.where('resourceType', 'diffuse').count(), `actorId ${actorId}`).toBe(1)
    }
  })
})

// Марс (actorId 8) — терраформная арка synth-heightmap, но height/slope из
// РЕАЛЬНОГО DEM (MOLA-корзина), не синтетического генератора, как у батча спутников
function mars(): Actor {
  return Actor.find(8)!
}

describe('PlanetMaterial: данные Марса — height/slope/detail-связки и ручки детального слоя (DEM)', () => {
  it('height-строка Марса: верный путь и резидентный lifecycle', () => {
    const row = mars().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/mars/mars_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Марса: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = mars().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/mars/mars_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('диффуз Марса несёт wrapS: RepeatWrapping в данных (терраформный шов меридиана)', () => {
    const diffuse = mars().resources.where('resourceType', 'diffuse').first()!

    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-тройка Марса — песчаный архетип terrain/sand_* (пилот приёмки), мелкая нормаль общая с Луной', () => {
    expectArchetypeDetailSet(mars(), 'sand')
  })

  it('renderingObjects Марса несёт ручки детального слоя террейна (detailSaturation 0.15 — планета)', () => {
    const data = mars().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.15)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
  })
})

// Плутон (actorId 14) — карликовая планета, терраформная арка synth-heightmap
// (height/slope из оффлайн-генератора, как у батча спутников)
function pluto(): Actor {
  return Actor.find(14)!
}

describe('PlanetMaterial: данные Плутона — height/slope/detail-связки и ручки детального слоя (synth)', () => {
  it('height-строка Плутона: верный путь и резидентный lifecycle', () => {
    const row = pluto().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/pluto/pluto_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Плутона: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = pluto().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/pluto/pluto_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('диффуз Плутона несёт wrapS: RepeatWrapping в данных (терраформный шов меридиана)', () => {
    const diffuse = pluto().resources.where('resourceType', 'diffuse').first()!

    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-тройка Плутона — ледяной архетип terrain/ice_*, мелкая нормаль общая с Луной', () => {
    const expectedPaths = {
      detailDiffuse: 'terrain/ice_diff.webp',
      detailNormal: 'terrain/ice_nor.webp',
      detailArm: 'terrain/ice_arm.webp'
    } as const

    for (const type of Object.keys(expectedPaths) as (keyof typeof expectedPaths)[]) {
      const path = expectedPaths[type]
      const row = pluto().resources.where('resourceType', type).first()

      expect(row, type).toBeDefined()
      expect(row!.getAttribute('path')).toBe(path)
      expect(row!.getAttribute('lifecycle')).toBe('streamable')
      expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
      expect(row!.getAttribute('wrapT')).toBe(RepeatWrapping)
    }

    const moonMicro = moon().resources.where('resourceType', 'detailNormal2').first()!
    const plutoMicro = pluto().resources.where('resourceType', 'detailNormal2').first()!
    expect(plutoMicro.getAttribute('id')).toBe(moonMicro.getAttribute('id'))
  })

  it('renderingObjects Плутона несёт ручки детального слоя террейна (detailSaturation 0.1 — карлик)', () => {
    const data = pluto().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.1)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
  })
})

// Девять твёрдых тел задачи 2: планеты (Меркурий, Венера, Марс, Церера) и
// карликовые (Плутон, Хаумеа, Макемаке, Эрида, Седна) — счётные инварианты
// одинаковы для всех, как у батча спутников выше
const NINE_BODIES_ACTOR_IDS = [5, 6, 8, 9, 14, 15, 16, 17, 18] as const

describe('PlanetMaterial: счётные инварианты девяти твёрдых тел (планеты + карликовые)', () => {
  it.each(NINE_BODIES_ACTOR_IDS)('actorId %i: пара height+slope, wrapS у slope и диффуза, bumpScale 1, ровно 6 терраформных связок', (actorId) => {
    const actor = Actor.find(actorId)!
    const height = actor.resources.where('resourceType', 'height').first()
    const slope = actor.resources.where('resourceType', 'slope').first()
    const diffuse = actor.resources.where('resourceType', 'diffuse').first()

    expect(height, `actorId ${actorId}: height`).toBeDefined()
    expect(slope, `actorId ${actorId}: slope`).toBeDefined()
    expect(slope!.getAttribute('wrapS'), `actorId ${actorId}: slope wrapS`).toBe(RepeatWrapping)
    expect(diffuse!.getAttribute('wrapS'), `actorId ${actorId}: diffuse wrapS`).toBe(RepeatWrapping)

    const data = actor.renderingObject!.getAttribute('data') as Record<string, unknown>
    expect(data.bumpScale, `actorId ${actorId}: bumpScale`).toBe(1)

    const terraformLinks = actor.resources.whereIn('resourceType', [...TERRAFORM_RESOURCE_TYPES]).count()
    expect(terraformLinks, `actorId ${actorId}: терраформные связки`).toBe(6)
  })
})

// Диона (actorId 27) — терраформная арка Task 2 стандартизации: реальная луна
// Сатурна, height/slope из оффлайн-генератора, детальные текстуры делятся
// с Луной (общие terrain/*.webp, шаринг ресурсов по id)
function dione(): Actor {
  return Actor.find(27)!
}

describe('PlanetMaterial: данные Дионы — height/slope/detail-связки и ручки детального слоя', () => {
  it('height-строка Дионы: верный путь и резидентный lifecycle', () => {
    const row = dione().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/dione/dione_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Дионы: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = dione().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/dione/dione_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('диффуз Дионы несёт wrapS: RepeatWrapping в данных (терраформный шов меридиана)', () => {
    const diffuse = dione().resources.where('resourceType', 'diffuse').first()!

    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-тройка Дионы — ледяной архетип terrain/ice_*, мелкая нормаль общая с Луной', () => {
    expectArchetypeDetailSet(dione(), 'ice')
  })

  it('renderingObjects Дионы несёт ручки детального слоя террейна (detailSaturation 0.1 — реальная луна)', () => {
    const data = dione().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.1)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
  })
})

// Ohann I (actorId 68) — терраформная арка Task 2: вымышленная планета, ДЕЛИТ
// вход-текстуру unnamed_planet_5.png с Adriana IV (actorId 74), но height/slope —
// пер-тело генерации (разные пути/сиды), а диффуз — СВОЯ строка ресурса
// (resourceId 100), отдельная от строки Adriana IV (resourceId 107) на тот же файл
function ohann1(): Actor {
  return Actor.find(68)!
}

describe('PlanetMaterial: данные Ohann I — height/slope/detail-связки, шаренный вход диффуза', () => {
  it('height-строка Ohann I: верный путь и резидентный lifecycle', () => {
    const row = ohann1().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/unnamed/ohann1_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Ohann I: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = ohann1().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/unnamed/ohann1_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('диффуз Ohann I: путь unnamed_planet_5.png (шаренный вход), wrapS RepeatWrapping, СВОЯ строка ресурса', () => {
    const diffuse = ohann1().resources.where('resourceType', 'diffuse').first()!
    const adriana4Diffuse = Actor.find(74)!.resources.where('resourceType', 'diffuse').first()!

    expect(diffuse.getAttribute('path')).toBe('planets/unnamed/unnamed_planet_5.png')
    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
    // общий файл, но разные строки ресурса (wrapS ставится обеим независимо)
    expect(diffuse.getAttribute('id')).not.toBe(adriana4Diffuse.getAttribute('id'))
    expect(adriana4Diffuse.getAttribute('path')).toBe('planets/unnamed/unnamed_planet_5.png')
    expect(adriana4Diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-связки Ohann I указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const ohann1Row = ohann1().resources.where('resourceType', type).first()

      expect(ohann1Row, type).toBeDefined()
      expect(ohann1Row!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(ohann1Row!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
  })

  it('renderingObjects Ohann I несёт ручки детального слоя террейна (detailSaturation 0.1 — вымышленная планета)', () => {
    const data = ohann1().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.1)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
  })
})

// Коррибан (actorId 88) — терраформная арка Task 2: планета с атмосферой и
// облаками (cloud-ресурс НЕ трогается этой волной), height/slope/detail —
// как у остальных 18 тел волны
function korriban(): Actor {
  return Actor.find(88)!
}

describe('PlanetMaterial: данные Коррибана — height/slope/detail-связки, атмосфера и облака не тронуты', () => {
  it('height-строка Коррибана: верный путь и резидентный lifecycle', () => {
    const row = korriban().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/StarWars/korriban/korriban_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Коррибана: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = korriban().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/StarWars/korriban/korriban_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('диффуз Коррибана несёт wrapS: RepeatWrapping в данных (терраформный шов меридиана)', () => {
    const diffuse = korriban().resources.where('resourceType', 'diffuse').first()!

    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-связки Коррибана указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const korribanRow = korriban().resources.where('resourceType', type).first()

      expect(korribanRow, type).toBeDefined()
      expect(korribanRow!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(korribanRow!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
  })

  it('renderingObjects Коррибана несёт ручки детального слоя террейна (detailSaturation 0.15 — Татуин/Коррибан)', () => {
    const data = korriban().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.15)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
  })

  it('cloud-строка Коррибана существует и привязана (эта волна её не трогает)', () => {
    const cloud = korriban().resources.where('resourceType', 'cloud').first()

    expect(cloud).toBeDefined()
    expect(cloud!.getAttribute('path')).toBe('planets/StarWars/korriban/korriban_clouds.png')
  })
})

// Все 19 тел Task 2 стандартизации: 9 реальных лун (Мимас..Оберон), Татуин,
// 3 луны Татуина, 2 Ohann, 3 Adriana (I/II/IV) и Коррибан — счётные инварианты
// одинаковы для всех, тот же паритет, что у батча 18 спутников и девяти тел выше
const TASK2_19_ACTOR_IDS = [24, 25, 26, 27, 31, 32, 33, 34, 35, 62, 65, 66, 67, 68, 69, 71, 72, 74, 88] as const

describe('PlanetMaterial: счётные инварианты 19 тел Task 2 стандартизации', () => {
  it.each(TASK2_19_ACTOR_IDS)('actorId %i: пара height+slope, wrapS у slope и диффуза, bumpScale 1, ровно 6 терраформных связок', (actorId) => {
    const actor = Actor.find(actorId)!
    const height = actor.resources.where('resourceType', 'height').first()
    const slope = actor.resources.where('resourceType', 'slope').first()
    const diffuse = actor.resources.where('resourceType', 'diffuse').first()

    expect(height, `actorId ${actorId}: height`).toBeDefined()
    expect(slope, `actorId ${actorId}: slope`).toBeDefined()
    expect(slope!.getAttribute('wrapS'), `actorId ${actorId}: slope wrapS`).toBe(RepeatWrapping)
    expect(diffuse!.getAttribute('wrapS'), `actorId ${actorId}: diffuse wrapS`).toBe(RepeatWrapping)

    const data = actor.renderingObject!.getAttribute('data') as Record<string, unknown>
    expect(data.bumpScale, `actorId ${actorId}: bumpScale`).toBe(1)

    const terraformLinks = actor.resources.whereIn('resourceType', [...TERRAFORM_RESOURCE_TYPES]).count()
    expect(terraformLinks, `actorId ${actorId}: терраформные связки`).toBe(6)
  })
})

// Ключ тела по actorId — тот же порядок, что в task-2-report.md (таблица
// соответствий). Нужен для проверки СВОЕГО суффикса пути ниже: счётные
// инварианты выше проверяют факт наличия height/slope и общие атрибуты, но
// не ловят подмену пути на чужой или на несуществующий файл, если тот
// формально проходит whereIn/wrapS-проверки (найдено финальным ревью —
// мутации «путь height Титании заменён на несуществующий» и «slope Оберона
// указывает на карту Титании» проходили зелёными).
const TASK2_BODY_KEYS: Record<number, string> = {
  24: 'mimas',
  25: 'enceladus',
  26: 'tethys',
  27: 'dione',
  31: 'miranda',
  32: 'ariel',
  33: 'umbriel',
  34: 'titania',
  35: 'oberon',
  62: 'tatooine',
  65: 'ghomrassen',
  66: 'guermessa',
  67: 'chenini',
  68: 'ohann1',
  69: 'ohann2',
  71: 'adriana1',
  72: 'adriana2',
  74: 'adriana4',
  88: 'korriban'
}

function dirOf(resourcePath: string): string {
  return resourcePath.slice(0, resourcePath.lastIndexOf('/'))
}

describe('PlanetMaterial: 19 тел Task 2 — пути не перепутаны и не подменены', () => {
  it('все 19 height-путей уникальны, все 19 slope-путей уникальны — ни одна карта не шарится между телами', () => {
    const heightPaths = TASK2_19_ACTOR_IDS.map(
      (actorId) => Actor.find(actorId)!.resources.where('resourceType', 'height').first()!.getAttribute('path')
    )
    const slopePaths = TASK2_19_ACTOR_IDS.map(
      (actorId) => Actor.find(actorId)!.resources.where('resourceType', 'slope').first()!.getAttribute('path')
    )

    expect(new Set(heightPaths).size, 'height-пути должны быть уникальны — общего размера 19').toBe(TASK2_19_ACTOR_IDS.length)
    expect(new Set(slopePaths).size, 'slope-пути должны быть уникальны — общего размера 19').toBe(TASK2_19_ACTOR_IDS.length)
  })

  it.each(TASK2_19_ACTOR_IDS)(
    'actorId %i: height/slope кончаются на СВОЙ суффикс и лежат в одной директории со своим diffuse',
    (actorId) => {
      const key = TASK2_BODY_KEYS[actorId]
      const actor = Actor.find(actorId)!
      const heightPath = actor.resources.where('resourceType', 'height').first()!.getAttribute('path') as string
      const slopePath = actor.resources.where('resourceType', 'slope').first()!.getAttribute('path') as string
      const diffusePath = actor.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string

      expect(heightPath, `actorId ${actorId}: height должен кончаться на ${key}_height.raw`).toMatch(
        new RegExp(`/${key}_height\\.raw$`)
      )
      expect(slopePath, `actorId ${actorId}: slope должен кончаться на ${key}_slope.webp`).toMatch(
        new RegExp(`/${key}_slope\\.webp$`)
      )
      expect(dirOf(heightPath), `actorId ${actorId}: height в той же директории, что diffuse`).toBe(dirOf(diffusePath))
      expect(dirOf(slopePath), `actorId ${actorId}: slope в той же директории, что diffuse`).toBe(dirOf(diffusePath))
    }
  )
})

describe('PlanetMaterial: зачистка облаков Титана и Венеры', () => {
  it('у Титана и Венеры облачной строки больше нет', () => {
    const titan = Actor.find(29)!
    const venus = Actor.find(6)!

    expect(titan.resources.where('resourceType', 'cloud').first()).toBeUndefined()
    expect(venus.resources.where('resourceType', 'cloud').first()).toBeUndefined()
  })

  it('у Земли и Корribана облачная строка на месте', () => {
    const earthCloud = earth().resources.where('resourceType', 'cloud').first()
    const korribanCloud = Actor.find(88)!.resources.where('resourceType', 'cloud').first()

    expect(earthCloud).toBeDefined()
    expect(korribanCloud).toBeDefined()
  })
})

describe('PlanetMaterial: гейты ночной и облачной карт', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('без ночной и облачной карт дефайны не ставятся', () => {
    const material = new PlanetMaterial(earth())
    material.updateMaterial()

    expect(material.defines.USE_NIGHT).toBeUndefined()
    expect(material.defines.USE_CLOUD).toBeUndefined()
  })

  // Облачный слой ВЕРНУЛСЯ решением владельца (2026-08-19, приёмочная волна
  // 4, №3): рулинг приёмочной волны 2 (№2 — полосы на полюсах от терраформной
  // равнопрямоугольной UV-развёртки) снят — идея владельца в том, что
  // высотный fade (uCloudOpacity, см. describe ниже) гасит слой ДО того, как
  // камера подлетает достаточно близко для видимых полос.
  it('с загруженными картами дефайны появляются', () => {
    const nightPath = earth().resources.where('resourceType', 'night').first()!.getAttribute('path') as string
    const cloudPath = earth().resources.where('resourceType', 'cloud').first()!.getAttribute('path') as string
    seedTexture(nightPath, 4096, 2048)
    seedTexture(cloudPath, 8192, 4096)

    const material = new PlanetMaterial(earth())
    material.updateMaterial()

    expect(material.defines.USE_NIGHT).toBe('1')
    expect(material.defines.USE_CLOUD).toBe('1')
  })

  it('resetMaterial снимает оба дефайна', () => {
    const nightPath = earth().resources.where('resourceType', 'night').first()!.getAttribute('path') as string
    const cloudPath = earth().resources.where('resourceType', 'cloud').first()!.getAttribute('path') as string
    seedTexture(nightPath, 4096, 2048)
    seedTexture(cloudPath, 8192, 4096)

    const material = new PlanetMaterial(earth())
    material.updateMaterial()
    expect(material.defines.USE_NIGHT).toBe('1')
    expect(material.defines.USE_CLOUD).toBe('1')

    material.resetMaterial()

    expect(material.defines.USE_NIGHT).toBeUndefined()
    expect(material.defines.USE_CLOUD).toBeUndefined()
  })
})

describe('PlanetMaterial: паритет юниформов шаблон↔рантайм', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  /**
   * `PlanetShader.ts` дублирует дефолты юниформов из `PlanetShaderTemplate.ts`
   * (см. PlanetShader.ts) вместо того, чтобы читать их оттуда. Ничто раньше не
   * сверяло рантайм с шаблоном — оба места молча могли разойтись. Этот тест
   * ловит именно расхождение: конструирует материал и сравнивает фактические
   * значения юниформов с дефолтами шаблона.
   */
  it('рантайм-дефолты юниформов совпадают с шаблоном', () => {
    const material = new PlanetMaterial(earth())

    const keys = ['uNightThreshold', 'uNightSoftness', 'uSpecularStrength', 'uCavityStrength'] as const

    for (const key of keys) {
      expect(material.uniforms[key].value).toBe(PlanetShaderTemplate.uniforms[key].value)
    }
  })
})

// Земля (actorId 7) — терраформная арка воды (Task 6): единственное тело с
// ПОЛНЫМ набором карт (диффуз+cloud+night+specular+height+slope+detail).
// Легаси-bump снят вместе со связкой (мёртвый вес — тело шейдит рельеф
// slope-картой, см. 30999f3). Фотомозаика (реальный снимок, не синтетическая
// генерация) — cavityStrength ей не полагается, тот же прецедент, что у
// Меркурия/Венеры/Марса/Луны.
describe('PlanetMaterial: данные Земли — полный набор карт, вода, легаси-bump снят', () => {
  it('height-строка Земли: верный путь и резидентный lifecycle', () => {
    const row = earth().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/earth/earth_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Земли: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = earth().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/earth/earth_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  // Тест «bump-строки у Земли больше нет» снят вместе с самим типом bump:
  // его отсутствие в БД теперь гарантирует страж ResourcesIntegrity.spec.

  it.each(['diffuse', 'cloud', 'night', 'specular'] as const)('%s Земли несёт wrapS: RepeatWrapping', (kind) => {
    const row = earth().resources.where('resourceType', kind).first()!

    expect(row.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-связки Земли указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const earthRow = earth().resources.where('resourceType', type).first()

      expect(earthRow, type).toBeDefined()
      expect(earthRow!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(earthRow!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
  })

  it('renderingObjects Земли несёт ручки детального слоя и waterLevelMeters, БЕЗ cavityStrength', () => {
    const data = earth().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.15)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
    expect(data.waterLevelMeters).toBe(0)
    expect(data.cavityStrength).toBeUndefined()
  })
})

// Явин IV (actorId 83) — терраформная арка воды (Task 6): возврат с легаси на
// height+slope, зеркально хотфиксу отката 2026-08-17 (см. task-2-report.md —
// источник уровня воды −667.2 м, замер F1 по корреляции с диффузом).
function yavinIV(): Actor {
  return Actor.find(83)!
}

describe('PlanetMaterial: данные Явина IV — height/slope/detail-связки возвращены, вода', () => {
  it('height-строка Явина IV: верный путь и резидентный lifecycle', () => {
    const row = yavinIV().resources.where('resourceType', 'height').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/StarWars/yavin/iv/yavin4_height.raw')
    expect(row!.getAttribute('lifecycle')).toBe('resident')
  })

  it('slope-строка Явина IV: верный путь, streamable, wrapS RepeatWrapping', () => {
    const row = yavinIV().resources.where('resourceType', 'slope').first()

    expect(row).toBeDefined()
    expect(row!.getAttribute('path')).toBe('planets/StarWars/yavin/iv/yavin4_slope.webp')
    expect(row!.getAttribute('lifecycle')).toBe('streamable')
    expect(row!.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('диффуз Явина IV несёт wrapS: RepeatWrapping в данных (терраформный шов меридиана)', () => {
    const diffuse = yavinIV().resources.where('resourceType', 'diffuse').first()!

    expect(diffuse.getAttribute('wrapS')).toBe(RepeatWrapping)
  })

  it('detail-связки Явина IV указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const yavinRow = yavinIV().resources.where('resourceType', type).first()

      expect(yavinRow, type).toBeDefined()
      expect(yavinRow!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(yavinRow!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
  })

  it('renderingObjects Явина IV несёт ручки детального слоя, cavityStrength и waterLevelMeters', () => {
    const data = yavinIV().renderingObject!.getAttribute('data') as Record<string, unknown>

    expect(data.bumpScale).toBe(1)
    expect(data.detailScaleMeters).toBe(40)
    expect(data.detailScale2Meters).toBe(7)
    expect(data.detailNormalScale).toBe(1)
    expect(data.detailSaturation).toBe(0.1)
    expect(data.detailBrightness).toBe(1)
    expect(data.detailAoInfluence).toBe(0.5)
    expect(data.detailFadeMeters).toBe(30000)
    expect(data.detailFade2Meters).toBe(5000)
    expect(data.cavityStrength).toBe(0.35)
    expect(data.waterLevelMeters).toBe(-667.2)
  })
})

/**
 * Хотфикс 2026-08-17: терраформный путь шейдера считает долготу двухдоменным
 * fract-трюком, и второй домен даёт u ∈ [−0.5, 0.5] — отрицательные значения
 * ClampToEdge растягивает краевым столбцом на полтела. Диффузам wrapS раздали
 * волнами перевода, но облачная карта Коррибана осталась без него и рисовала
 * дуги вместо облаков. Инвариант общий: ЛЮБАЯ карта, которую фрагмент читает
 * по терраформному uv, обязана иметь wrapS.
 */
describe('PlanetMaterial: карты терраформных тел, читаемые по общему uv, заворачиваются по долготе', () => {
  const SAMPLED_BY_TERRAIN_UV: readonly ResourceType[] = ['diffuse', 'cloud', 'night', 'specular']

  const terraformActors = Actor.all()
    .filter((actor) => actor.resources.where('resourceType', 'height').first() !== undefined)
    .all()

  it('терраформных тел в базе больше десятка — выборка инварианта не выродилась', () => {
    expect(terraformActors.length).toBeGreaterThan(10)
  })

  it.each(SAMPLED_BY_TERRAIN_UV)('%s: wrapS: RepeatWrapping у всех терраформных тел', (kind) => {
    const offenders = terraformActors
      .flatMap((actor) =>
        actor.resources
          .where('resourceType', kind)
          .all()
          .map((resource) => ({ name: actor.getAttribute('name', ''), resource }))
      )
      .filter(({ resource }) => resource.getAttribute('wrapS') !== RepeatWrapping)
      .map(({ name, resource }) => name + ': ' + String(resource.getAttribute('path')))

    expect(offenders).toEqual([])
  })
})

// waterNormal-ассет (арка water-shader, Task 3): ровно два тела в БД несут
// waterLevelMeters в data (Земля actorId 7, Явин IV actorId 83, см.
// storage/database/renderingObjects.ts) — оба обязаны иметь ровно одну
// waterNormal-связку на ОБЩИЙ resourceId (шаринг тайлящегося ассета по пути,
// одна копия в VRAM, см. task-3-brief.md), resident lifecycle, wrapS+wrapT
// Repeat (трипланарный getNoise, WaterShaderTemplate). Любое тело без
// waterLevelMeters — waterNormal-связок ноль.
describe('PlanetMaterial: данные waterNormal-ассета (Task 3 арки water-shader)', () => {
  const WATER_ACTOR_IDS = [7, 83] as const
  const WATER_ACTOR_ID_SET = new Set<number>(WATER_ACTOR_IDS)

  const waterActors = Actor.all()
    .filter((actor) => {
      const data = actor.renderingObject?.getAttribute('data') as Record<string, unknown> | undefined
      return data?.waterLevelMeters !== undefined
    })
    .all()

  it('ровно два тела в БД несут waterLevelMeters — Земля и Явин IV, выборка не разъехалась', () => {
    const ids = waterActors.map((actor) => actor.getAttribute('id') as number).sort((a, b) => a - b)
    expect(ids).toEqual([...WATER_ACTOR_IDS])
  })

  it.each(WATER_ACTOR_IDS)(
    'actorId %i: ровно одна waterNormal-связка, resident, wrapS+wrapT Repeat, путь water/waternormals.jpg',
    (actorId) => {
      const actor = Actor.find(actorId)!
      const links = actor.resources.where('resourceType', 'waterNormal')

      expect(links.count(), `actorId ${actorId}: waterNormal-связок`).toBe(1)

      const row = links.first()!
      expect(row.getAttribute('path'), `actorId ${actorId}: path`).toBe('water/waternormals.jpg')
      expect(row.getAttribute('lifecycle'), `actorId ${actorId}: lifecycle`).toBe('resident')
      expect(row.getAttribute('wrapS'), `actorId ${actorId}: wrapS`).toBe(RepeatWrapping)
      expect(row.getAttribute('wrapT'), `actorId ${actorId}: wrapT`).toBe(RepeatWrapping)
    }
  )

  it('Земля и Явин IV шарят ОДИН resourceId waterNormal — одна текстура в VRAM', () => {
    const earthRow = earth().resources.where('resourceType', 'waterNormal').first()!
    const yavinRow = Actor.find(83)!.resources.where('resourceType', 'waterNormal').first()!

    expect(earthRow.getAttribute('id')).toBe(yavinRow.getAttribute('id'))
  })

  it('у тел без waterLevelMeters waterNormal-связок нет вовсе', () => {
    const offenders = Actor.all()
      .filter((actor) => !WATER_ACTOR_ID_SET.has(actor.getAttribute('id') as number))
      .all()
      .filter((actor) => actor.resources.where('resourceType', 'waterNormal').first() !== undefined)
      .map((actor) => actor.getAttribute('id'))

    expect(offenders).toEqual([])
  })
})

// Архетипы грунта (кампания «облик рельефа», арка 1): детальная тройка тела —
// diffuse+normal+ARM ОДНОГО набора terrain/<archetype>_*, мелкая нормаль общая.
// Тест дискриминирует ПУТИ: смесь «лёд-нормаль + камень-диффуз» — дефект пивотов.
const SHARED_MICRO_NORMAL_PATH = 'terrain/moon_01_nor.webp'

function archetypeOf(path: string): string | null {
  const match = /^terrain\/(.+)_(diff|nor|arm)\.webp$/.exec(path)
  return match ? match[1] : null
}

describe('PlanetMaterial: у каждого терраформного тела полный комплект детали одного архетипа', () => {
  const terraformActors = Actor.all()
    .filter((actor) => actor.resources.where('resourceType', 'height').first() !== undefined)
    .all()

  it('в базе есть терраформные тела', () => {
    expect(terraformActors.length).toBeGreaterThan(40)
  })

  it.each(terraformActors.map((actor) => [actor.getAttribute('id') as number] as const))(
    'actorId %i: diffuse/normal/ARM из одной тройки terrain/<archetype>_*, мелкая нормаль — общая',
    (actorId) => {
      const actor = Actor.find(actorId)!
      const archetypes = (['detailDiffuse', 'detailNormal', 'detailArm'] as const).map((type) => {
        const row = actor.resources.where('resourceType', type).first()
        expect(row, `actorId ${actorId}: ${type}`).toBeDefined()
        return archetypeOf(row!.getAttribute('path') as string)
      })

      expect(archetypes[0], `actorId ${actorId}: путь детали вне схемы terrain/<archetype>_*`).not.toBeNull()
      expect(new Set(archetypes).size, `actorId ${actorId}: смесь архетипов ${archetypes.join('/')}`).toBe(1)

      const micro = actor.resources.where('resourceType', 'detailNormal2').first()
      expect(micro, `actorId ${actorId}: detailNormal2`).toBeDefined()
      expect(micro!.getAttribute('path')).toBe(SHARED_MICRO_NORMAL_PATH)
    }
  )

  // Раскладка спеки архетипов (2026-08-24) после раската ice (2026-08-30): 23 ледяных тела —
  // ледяные луны Юпитера/Сатурна/Урана/Нептуна, Плутон/Харон, КБО, Оханн II (тёмно-серый диффуз);
  // Оханн I (бурый диффуз) остался камнем. Япет/Каллисто — тёмный лёд, откат на камень = строка пивота.
  const ICE_ACTOR_IDS = [14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 37, 38, 69] as const

  const archetype = (actorId: number): string | null =>
    archetypeOf(Actor.find(actorId)!.resources.where('resourceType', 'detailDiffuse').first()!.getAttribute('path') as string)

  it.each(ICE_ACTOR_IDS)('actorId %i — ледяной архетип', (actorId) => {
    expect(archetype(actorId)).toBe('ice')
  })

  // Раскладка sand/volcanic (2026-08-31, приёмка пилотов пройдена): sand — Марс, Титан, Татуин,
  // Гермесса (66) и Адриана IV (74) — тёплые песчаные диффузы; Гомрассен/Хенини/Адриана II — серые,
  // остались камнем. volcanic — Венера (6) и Ио (20).
  const SAND_ACTOR_IDS = [8, 29, 62, 66, 74] as const
  const VOLCANIC_ACTOR_IDS = [6, 20] as const

  it.each(SAND_ACTOR_IDS)('actorId %i — песчаный архетип', (actorId) => {
    expect(archetype(actorId)).toBe('sand')
  })

  it.each(VOLCANIC_ACTOR_IDS)('actorId %i — вулканический архетип', (actorId) => {
    expect(archetype(actorId)).toBe('volcanic')
  })

  it('ледяных тел в базе ровно столько, сколько в раскладке — и контрольные тела на камне', () => {
    const iceActors = terraformActors.filter((actor) => archetype(actor.getAttribute('id') as number) === 'ice')
    expect(iceActors.map((actor) => actor.getAttribute('id')).sort((a, b) => Number(a) - Number(b))).toEqual([...ICE_ACTOR_IDS])

    for (const actorId of [19, 5, 65, 68]) expect(archetype(actorId), `actorId ${actorId}`).toBe('rocky_trail')
  })
})
