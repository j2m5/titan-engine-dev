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

// Все 18 тел батча (терраформная арка synth-heightmap): 12 генераций, Корribан I-VII (93-99)
// делят одну карту — счётные инварианты одинаковы для всех, без разбора по конкретным путям
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

  it('Корribан I-VII (93-99) ссылаются на одни и те же height/slope-строки', () => {
    const leader = Actor.find(93)!.resources
    const leaderHeight = leader.where('resourceType', 'height').first()!.getAttribute('id')
    const leaderSlope = leader.where('resourceType', 'slope').first()!.getAttribute('id')

    for (const actorId of [94, 95, 96, 97, 98, 99]) {
      const resources = Actor.find(actorId)!.resources
      expect(resources.where('resourceType', 'height').first()!.getAttribute('id'), `actorId ${actorId}`).toBe(leaderHeight)
      expect(resources.where('resourceType', 'slope').first()!.getAttribute('id'), `actorId ${actorId}`).toBe(leaderSlope)
    }
  })
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
