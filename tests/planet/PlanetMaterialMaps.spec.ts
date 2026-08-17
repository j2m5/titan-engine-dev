import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { Actor } from '@/core/models/Actor'
import { ResourceType } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
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

describe('PlanetMaterial: привязка карт к юниформам', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('шаг текселя берётся из размеров загруженной карты высот', () => {
    seedTexture(pathOf('bump'), 8192, 4096)

    const material = new PlanetMaterial(earth())
    material.updateMaterial()

    expect(material.uniforms.uBumpTexelSize.value.x).toBeCloseTo(1 / 8192, 10)
    expect(material.uniforms.uBumpTexelSize.value.y).toBeCloseTo(1 / 4096, 10)
    expect(material.defines.USE_BUMP).toBe('1')
  })

  it('без карты высот шаг нулевой — рельеф выключается, а не мусорит', () => {
    const material = new PlanetMaterial(earth())
    material.updateMaterial()

    expect(material.uniforms.uBumpTexelSize.value.x).toBe(0)
    expect(material.uniforms.uBumpTexelSize.value.y).toBe(0)
    expect(material.defines.USE_BUMP).toBeUndefined()
  })

  it('resetMaterial возвращает шаг в ноль', () => {
    seedTexture(pathOf('bump'), 8192, 4096)

    const material = new PlanetMaterial(earth())
    material.updateMaterial()
    material.resetMaterial()

    expect(material.uniforms.uBumpTexelSize.value.x).toBe(0)
    expect(material.uniforms.uBumpTexelSize.value.y).toBe(0)
  })
})

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
    expect(material.defines.USE_BUMP).toBeUndefined()
    expect(material.uniforms.bumpMap.value).not.toBeNull()
    // шаг текселя — атрибут четырёхвыборочного bump-пути, slope-пути не нужен
    expect(material.uniforms.uBumpTexelSize.value.x).toBe(0)
    expect(material.uniforms.uBumpTexelSize.value.y).toBe(0)
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
    seedTexture(pathOf('bump'), 8192, 4096)

    const material = new PlanetMaterial(earth())
    material.updateMaterial()

    expect((material.uniforms.diffuseMap.value as Texture).wrapS).toBe(ClampToEdgeWrapping)
    expect((material.uniforms.bumpMap.value as Texture).wrapS).toBe(ClampToEdgeWrapping)
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

  it('detail-связки Каллисто указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const callistoRow = callisto().resources.where('resourceType', type).first()

      expect(callistoRow, type).toBeDefined()
      expect(callistoRow!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(callistoRow!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
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

  it('detail-связки Европы указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const europaRow = europa().resources.where('resourceType', type).first()

      expect(europaRow, type).toBeDefined()
      expect(europaRow!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(europaRow!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
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

  it('detail-связки Реи указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const rheaRow = rhea().resources.where('resourceType', type).first()

      expect(rheaRow, type).toBeDefined()
      expect(rheaRow!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(rheaRow!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
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

  it('detail-связки Ио указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const ioRow = io().resources.where('resourceType', type).first()

      expect(ioRow, type).toBeDefined()
      expect(ioRow!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(ioRow!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
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

// Все 18 тел батча (терраформная арка synth-heightmap): 12+6 генераций (фикс-раунд 1 Task 4
// перевёл Корribан I-VII на пер-тело height/slope — общая карта, откалиброванная под радиус I,
// давала VII 577% его бюджета высоты) — счётные инварианты одинаковы для всех
const BATCH_ACTOR_IDS = [20, 22, 28, 29, 30, 36, 37, 38, 73, 83, 70, 93, 94, 95, 96, 97, 98, 99] as const
const TERRAFORM_RESOURCE_TYPES = ['height', 'slope', 'detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const

describe('PlanetMaterial: счётные инварианты батча 18 спутников', () => {
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

  it('detail-связки Марса указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const marsRow = mars().resources.where('resourceType', type).first()

      expect(marsRow, type).toBeDefined()
      expect(marsRow!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(marsRow!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
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

  it('detail-связки Плутона указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const plutoRow = pluto().resources.where('resourceType', type).first()

      expect(plutoRow, type).toBeDefined()
      expect(plutoRow!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(plutoRow!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
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

  it('detail-связки Дионы указывают на те же ресурсы terrain/*.webp, что у Луны — шаринг по id', () => {
    for (const type of ['detailDiffuse', 'detailNormal', 'detailArm', 'detailNormal2'] as const) {
      const moonRow = moon().resources.where('resourceType', type).first()
      const dioneRow = dione().resources.where('resourceType', type).first()

      expect(dioneRow, type).toBeDefined()
      expect(dioneRow!.getAttribute('id')).toBe(moonRow!.getAttribute('id'))
      expect(dioneRow!.getAttribute('path')).toBe(moonRow!.getAttribute('path'))
    }
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

    const keys = ['uNightThreshold', 'uNightSoftness', 'uSpecularStrength'] as const

    for (const key of keys) {
      expect(material.uniforms[key].value).toBe(PlanetShaderTemplate.uniforms[key].value)
    }
  })
})
