import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { terrainDetailFunctions, terrainDetailUniforms } from '@/core/materials/shaders/lib/chunks/TerrainDetail'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import { ResourceType } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { Texture } from 'three'

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
  })

  it('применяет крупную шкалу через triplanar*-функции с uDetail-самплерами — бленд не копируется', () => {
    expect(terrainDetailFunctions).toContain('triplanarWeights(dirLocal)')
    expect(terrainDetailFunctions).toContain('triplanarNormal(uDetailNorMap')
    expect(terrainDetailFunctions).toContain('triplanarArm(uDetailArmMap')
    expect(terrainDetailFunctions).toContain('triplanarAlbedo(uDetailDiffMap')
  })

  it('мелкая шкала несёт только нормаль — на uDetailNor2Map', () => {
    expect(terrainDetailFunctions).toContain('triplanarNormal(uDetailNor2Map')
    // мелкая шкала не модулирует AO/diffuse — второго triplanarArm/Albedo нет
    const armCalls = terrainDetailFunctions.split('triplanarArm(').length - 1
    const albedoCalls = terrainDetailFunctions.split('triplanarAlbedo(').length - 1
    expect(armCalls).toBe(1)
    expect(albedoCalls).toBe(1)
  })

  it('всё тело — за общей веткой fade: гейт стоит текстуально раньше первой выборки', () => {
    const gateIdx = terrainDetailFunctions.indexOf('if (')
    const firstSampleIdx = terrainDetailFunctions.indexOf('triplanar')
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
