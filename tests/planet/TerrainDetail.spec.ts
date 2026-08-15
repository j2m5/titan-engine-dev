import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { terrainDetailFunctions, terrainDetailUniforms } from '@/core/materials/shaders/lib/chunks/TerrainDetail'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import { ResourceType } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { Texture, Vector4 } from 'three'

// Луна (actorId 19) — единственное тело с полным набором terrain-детали
function moon(): Actor {
  return Actor.find(19)!
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

function seedMoonHeightMap(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(moonPathOf('height'), {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moonPathOf('diffuse'))
}

describe('TerrainDetail: чанк — регистрация и структура', () => {
  it('чанк зарегистрирован — иначе include молча раскроется в пустоту', () => {
    expect(AppShaderChunk.terrainDetailUniforms).toBe(terrainDetailUniforms)
    expect(AppShaderChunk.terrainDetailFunctions).toBe(terrainDetailFunctions)
  })

  it('четыре сэмплера и обе шкалы объявлены юниформами', () => {
    expect(terrainDetailUniforms).toContain('uniform sampler2D uDetailDiffMap;')
    expect(terrainDetailUniforms).toContain('uniform sampler2D uDetailNorMap;')
    expect(terrainDetailUniforms).toContain('uniform sampler2D uDetailArmMap;')
    expect(terrainDetailUniforms).toContain('uniform sampler2D uDetailNor2Map;')
    expect(terrainDetailUniforms).toContain('uniform float uDetailScale;')
    expect(terrainDetailUniforms).toContain('uniform float uDetailScale2;')
    expect(terrainDetailUniforms).toContain('uniform vec3 uDetailLayerGates;')
    expect(terrainDetailUniforms).toContain('uniform vec4 uDetailFadeRange;')
  })

  it('фейд читается из uDetailFadeRange (start1, end1, start2, end2) — не из периода шкалы на GLSL', () => {
    expect(terrainDetailFunctions).toContain('uDetailFadeRange.x, uDetailFadeRange.y')
    expect(terrainDetailFunctions).toContain('uDetailFadeRange.z, uDetailFadeRange.w')
    expect(terrainDetailFunctions).not.toContain('60.0 *')
    expect(terrainDetailFunctions).not.toContain('160.0 *')
  })

  it('применяет крупную шкалу через стохастические обёртки с uDetail-самплерами — бленд не копируется', () => {
    expect(terrainDetailFunctions).toContain('triplanarWeights(dirLocal)')
    expect(terrainDetailFunctions).toContain('triplanarNormalDetiled(uDetailNorMap')
    expect(terrainDetailFunctions).toContain('triplanarArmDetiled(uDetailArmMap')
    expect(terrainDetailFunctions).toContain('triplanarAlbedoDetiled(uDetailDiffMap')
  })

  it('мелкая шкала несёт только нормаль — на uDetailNor2Map', () => {
    expect(terrainDetailFunctions).toContain('triplanarNormalDetiled(uDetailNor2Map')
    // мелкая шкала не модулирует AO/diffuse — второго вызова triplanarArmDetiled/
    // AlbedoDetiled нет. Обёртки объявлены тут же (1 вхождение — определение),
    // так что второе вхождение подстроки — единственный вызов (крупная шкала).
    const armCalls = terrainDetailFunctions.split('triplanarArmDetiled(').length - 1
    const albedoCalls = terrainDetailFunctions.split('triplanarAlbedoDetiled(').length - 1
    expect(armCalls).toBe(2)
    expect(albedoCalls).toBe(2)
  })

  it('стохастические обёртки существуют и зовут общее triplanar-ядро бленда, не копируют его', () => {
    expect(terrainDetailFunctions).toContain(
      'vec3 triplanarNormalDetiled(sampler2D map, vec3 p, vec3 n, vec3 w, vec2 offset)'
    )
    expect(terrainDetailFunctions).toContain('vec3 triplanarArmDetiled(sampler2D map, vec3 p, vec3 w, vec2 offset)')
    expect(terrainDetailFunctions).toContain(
      'vec3 triplanarAlbedoDetiled(sampler2D map, vec3 p, vec3 w, vec2 offset)'
    )
    expect(terrainDetailFunctions).toContain('triplanarBlendNormal(')
    expect(terrainDetailFunctions).toContain('triplanarBlendRgb(')
  })

  it('sampleDetiled: хеш ячейки от квантованной (floor) величины, не от сырого uv', () => {
    expect(terrainDetailFunctions).toContain('vec4 sampleDetiled(sampler2D map, vec2 uv)')
    expect(terrainDetailFunctions).toContain('floor(uv)')
    expect(terrainDetailFunctions).toContain('hashCell2(cell)')
  })

  it('sampleDetiled использует textureGrad-эквивалент с производными исходного uv — без мип-швов на границе ячеек', () => {
    const bodyStart = terrainDetailFunctions.indexOf('vec4 sampleDetiled(')
    const bodyEnd = terrainDetailFunctions.indexOf('\n  }', bodyStart)
    const body = terrainDetailFunctions.slice(bodyStart, bodyEnd)

    expect(body).toContain('dFdx(uv)')
    expect(body).toContain('dFdy(uv)')
    expect(body).toContain('texture2DGradEXT(map,')
    // никакого texture2D(map, ...) внутри — иначе прежний мип-шов на границе ячейки не лечится
    expect(body).not.toMatch(/texture2D\(map,/)
  })

  it('бленд двух ближайших ячеек — по smoothstep, не по бинарному выбору', () => {
    const bodyStart = terrainDetailFunctions.indexOf('vec4 sampleDetiled(')
    const bodyEnd = terrainDetailFunctions.indexOf('\n  }', bodyStart)
    const body = terrainDetailFunctions.slice(bodyStart, bodyEnd)

    expect(body).toContain('smoothstep(')
    expect(body).toContain('mix(colA, colB, blend)')
  })

  it('всё тело — за общей веткой fade: гейт стоит текстуально раньше первой выборки', () => {
    // Область поиска — тело applyTerrainDetail, а не весь чанк: стохастические
    // обёртки (triplanarNormalDetiled и т.п.) объявлены как отдельные функции
    // раньше applyTerrainDetail по тексту чанка, но САМИ они не выборка (тело
    // sampleDetiled не за fade-гейтом — гейт только вокруг ВЫЗОВОВ в applyTerrainDetail).
    const applyStart = terrainDetailFunctions.indexOf('void applyTerrainDetail(')
    const body = terrainDetailFunctions.slice(applyStart)
    const gateIdx = body.indexOf('if (')
    const firstSampleIdx = body.indexOf('triplanar')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(firstSampleIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(firstSampleIdx)
  })

  it('гейты слоёв читаются как множители — ao/diffuse/scale2 не жёстко включены', () => {
    expect(terrainDetailFunctions).toContain('uDetailLayerGates.x')
    expect(terrainDetailFunctions).toContain('uDetailLayerGates.y')
    expect(terrainDetailFunctions).toContain('uDetailLayerGates.z')
  })

  it('сигнатура applyTerrainDetail совпадает с интерфейсом брифа', () => {
    expect(terrainDetailFunctions).toContain(
      'void applyTerrainDetail(inout vec3 nLocal, inout vec3 albedoMul, vec3 dirLocal, float viewDistance)'
    )
  })
})

describe('TerrainDetail: хук в терраформной ветке шаблона', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader

  it('ветка USE_TERRAIN_DETAIL подключает чанк', () => {
    expect(frag).toContain('#ifdef USE_TERRAIN_DETAIL')
    expect(frag).toContain('#include <terrainDetailUniforms>')
    expect(frag).toContain('#include <terrainDetailFunctions>')
  })

  it('applyTerrainDetail зовётся строго перед финальным normalMatrix', () => {
    const callIdx = frag.indexOf('applyTerrainDetail(nLocal, albedoMul, dirLocal, length(vViewPosition))')
    const finalIdx = frag.indexOf('normal = normalize(normalMatrix * nLocal);')
    expect(callIdx).toBeGreaterThan(-1)
    expect(finalIdx).toBeGreaterThan(-1)
    expect(callIdx).toBeLessThan(finalIdx)
  })

  it('albedoMul применяется на месте выборки dayColor', () => {
    const dayColorIdx = frag.indexOf('vec3 dayColor = texture2D(diffuseMap, uv).rgb;')
    const mulIdx = frag.indexOf('dayColor *= albedoMul;')
    expect(dayColorIdx).toBeGreaterThan(-1)
    expect(mulIdx).toBeGreaterThan(dayColorIdx)
  })
})

describe('PlanetMaterial: терраформный детальный слой', () => {
  beforeEach(() => {
    seedPlaceholderKeys()
  })
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
  })

  it('USE_TERRAIN_DETAIL появляется при карте высот и detailNormal', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('detailNormal'), 8, 4)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_DETAIL).toBe('1')
  })

  it('без detailNormal — дефайн молчит, даже если остальные три текстуры загружены', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('detailDiffuse'), 8, 4)
    seedTexture(moonPathOf('detailArm'), 8, 4)
    seedTexture(moonPathOf('detailNormal2'), 8, 4)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_DETAIL).toBeUndefined()
  })

  it('без карты высот дефайн молчит, даже если detailNormal загружен', () => {
    seedTexture(moonPathOf('detailNormal'), 8, 4)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_TERRAIN_DETAIL).toBeUndefined()
  })

  it('гейты слоёв следуют фактическому наличию текстур поэлементно', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('detailNormal'), 8, 4)
    seedTexture(moonPathOf('detailArm'), 8, 4)
    // detailDiffuse и detailNormal2 намеренно не загружены

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.uniforms.uDetailLayerGates.value.x).toBe(1) // ao
    expect(material.uniforms.uDetailLayerGates.value.y).toBe(0) // diffuse
    expect(material.uniforms.uDetailLayerGates.value.z).toBe(0) // scale2
  })

  it('четыре текстуры биндятся в соответствующие юниформы', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('detailNormal'), 8, 4)
    seedTexture(moonPathOf('detailDiffuse'), 8, 4)
    seedTexture(moonPathOf('detailArm'), 8, 4)
    seedTexture(moonPathOf('detailNormal2'), 8, 4)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect((material.uniforms.uDetailNorMap.value as Texture).name).toBe(moonPathOf('detailNormal'))
    expect((material.uniforms.uDetailDiffMap.value as Texture).name).toBe(moonPathOf('detailDiffuse'))
    expect((material.uniforms.uDetailArmMap.value as Texture).name).toBe(moonPathOf('detailArm'))
    expect((material.uniforms.uDetailNor2Map.value as Texture).name).toBe(moonPathOf('detailNormal2'))
  })

  it('ручки из data доезжают в юниформы (паритет с бумскейлом) — периоды пересчитаны из метров', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('detailNormal'), 8, 4)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    // Ручки Луны (storage/database/renderingObjects.ts): 40м / 7м период
    expect(material.uniforms.uDetailScale.value).toBeCloseTo(1 / toThreeJSUnits(40 / 1000), 10)
    expect(material.uniforms.uDetailScale2.value).toBeCloseTo(1 / toThreeJSUnits(7 / 1000), 10)
    expect(material.uniforms.uDetailNormalScale.value).toBe(1)
    expect(material.uniforms.uDetailSaturation.value).toBeCloseTo(0.15, 10)
    expect(material.uniforms.uDetailBrightness.value).toBe(1)
    expect(material.uniforms.uDetailAoInfluence.value).toBeCloseTo(0.5, 10)
  })

  it('fade доезжает в юниформ vec4 (start = 0.4×end, конец из detailFadeMeters/detailFade2Meters) — ручки Луны 30000/5000 м', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('detailNormal'), 8, 4)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    const end1 = toThreeJSUnits(30000 / 1000)
    const end2 = toThreeJSUnits(5000 / 1000)
    const range = material.uniforms.uDetailFadeRange.value as Vector4
    expect(range.x).toBeCloseTo(end1 * 0.4, 10)
    expect(range.y).toBeCloseTo(end1, 10)
    expect(range.z).toBeCloseTo(end2 * 0.4, 10)
    expect(range.w).toBeCloseTo(end2, 10)
  })

  it('без detail-полей в data юниформы получают дефолты (Земля, actorId 7 — bumpScale задан, детали нет)', () => {
    const material = new PlanetMaterial(Actor.find(7)!)

    // Дефолты PlanetShader.ts (DEFAULT_DETAIL_*) — совпадают с ручками Луны по значению,
    // но здесь их источник другой: у Земли detail*-полей в data нет вовсе (id 43 в
    // storage/database/renderingObjects.ts), значения приходят только из фолбэка `?? DEFAULT_DETAIL_*`.
    expect(material.uniforms.uDetailScale.value).toBeCloseTo(1 / toThreeJSUnits(40 / 1000), 10)
    expect(material.uniforms.uDetailScale2.value).toBeCloseTo(1 / toThreeJSUnits(7 / 1000), 10)
    expect(material.uniforms.uDetailNormalScale.value).toBe(1)
    expect(material.uniforms.uDetailSaturation.value).toBeCloseTo(0.15, 10)
    expect(material.uniforms.uDetailBrightness.value).toBe(1)
    expect(material.uniforms.uDetailAoInfluence.value).toBeCloseTo(0.5, 10)

    // detailFadeMeters/detailFade2Meters тоже отсутствуют — фолбэк на DEFAULT_DETAIL_FADE_METERS
    // (30000) и DEFAULT_DETAIL_FADE2_METERS (5000), численно те же, что явные ручки Луны выше.
    const end1 = toThreeJSUnits(30000 / 1000)
    const end2 = toThreeJSUnits(5000 / 1000)
    const range = material.uniforms.uDetailFadeRange.value as Vector4
    expect(range.x).toBeCloseTo(end1 * 0.4, 10)
    expect(range.y).toBeCloseTo(end1, 10)
    expect(range.z).toBeCloseTo(end2 * 0.4, 10)
    expect(range.w).toBeCloseTo(end2, 10)
  })

  it('resetMaterial снимает дефайн и обнуляет гейты и текстуры', () => {
    seedMoonHeightMap()
    seedTexture(moonPathOf('detailNormal'), 8, 4)
    seedTexture(moonPathOf('detailDiffuse'), 8, 4)
    seedTexture(moonPathOf('detailArm'), 8, 4)
    seedTexture(moonPathOf('detailNormal2'), 8, 4)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()
    expect(material.defines.USE_TERRAIN_DETAIL).toBe('1')

    material.resetMaterial()

    expect(material.defines.USE_TERRAIN_DETAIL).toBeUndefined()
    expect(material.uniforms.uDetailLayerGates.value.x).toBe(0)
    expect(material.uniforms.uDetailLayerGates.value.y).toBe(0)
    expect(material.uniforms.uDetailLayerGates.value.z).toBe(0)
    expect(material.uniforms.uDetailNorMap.value).toBeNull()
    expect(material.uniforms.uDetailDiffMap.value).toBeNull()
    expect(material.uniforms.uDetailArmMap.value).toBeNull()
    expect(material.uniforms.uDetailNor2Map.value).toBeNull()
  })
})
