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
    // родной набор читается через общий helper sampleDetailSet (зоны материала,
    // задача 2) — сам helper вызывает triplanarNormal/Arm/AlbedoDetiled параметризованно
    expect(terrainDetailFunctions).toContain('sampleDetailSet(uDetailNorMap, uDetailArmMap, uDetailDiffMap')
    expect(terrainDetailFunctions).toContain('triplanarNormalDetiled(nor')
    expect(terrainDetailFunctions).toContain('triplanarArmDetiled(arm')
    expect(terrainDetailFunctions).toContain('triplanarAlbedoDetiled(diff')
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

  it('стохастические обёртки существуют, разделяют общий l и зовут triplanar-ядро бленда, не копируют его', () => {
    // сигнатуры берут готовый TriplanarUv (uv+dFdx/dFdy, посчитан ДО
    // ветвлений — фикс-раунд 2, мип-волоски вдоль изоконтуров маски зон),
    // сами больше не считают dFdx/dFdy — см. тест на позицию dFdx( ниже
    expect(terrainDetailFunctions).toContain('vec3 triplanarNormalDetiled(sampler2D map, TriplanarUv t, vec3 n, vec3 w, vec3 l)')
    expect(terrainDetailFunctions).toContain('vec3 triplanarArmDetiled(sampler2D map, TriplanarUv t, vec3 w, vec3 l)')
    expect(terrainDetailFunctions).toContain('vec3 triplanarAlbedoDetiled(sampler2D map, TriplanarUv t, vec3 w, vec3 l)')
    expect(terrainDetailFunctions).toContain('triplanarBlendNormal(')
    expect(terrainDetailFunctions).toContain('triplanarBlendRgb(')
  })

  it('TriplanarUv: производные считаются ровно один раз, в triplanarUvFor — обёртки их не пересчитывают', () => {
    expect(terrainDetailFunctions).toContain('struct TriplanarUv {')
    expect(terrainDetailFunctions).toContain('TriplanarUv triplanarUvFor(vec3 p, float scale)')
    // ровно 6 вызовов dFdx/dFdy на весь чанк — по одному на проекцию×ось,
    // внутри triplanarUvFor; обёртки (Normal/Arm/AlbedoDetiled) и sampleDetailSet
    // читают уже готовые t.zyDx/t.zyDy и т.п., не зовут dFdx/dFdy сами
    const dFdxCalls = (terrainDetailFunctions.match(/dFdx\(/g) ?? []).length
    const dFdyCalls = (terrainDetailFunctions.match(/dFdy\(/g) ?? []).length
    expect(dFdxCalls).toBe(3)
    expect(dFdyCalls).toBe(3)
  })

  it('vnoise и хеши — квантованные (floor), никакой ячейки от сырого текстурного uv', () => {
    expect(terrainDetailFunctions).toContain('float hash21(vec2 p)')
    expect(terrainDetailFunctions).toContain('vec2 hash22(vec2 p)')
    expect(terrainDetailFunctions).toContain('float vnoise(vec2 p)')
    // критическая находка ревью: 2-тап «текущая ячейка uv + диагональный сосед» по
    // floor(uv) даёт разрыв на КАЖДОЙ границе ячейки — заменено непрерывным индексом l
    expect(terrainDetailFunctions).not.toContain('floor(uv)')
    expect(terrainDetailFunctions).not.toContain('hashCell2')
  })

  it('sampleDetiled: непрерывный 2-тап по floor(l)/fract(l), без знакового флипа оси', () => {
    expect(terrainDetailFunctions).toContain(
      'vec4 sampleDetiled(sampler2D map, vec2 uv, vec2 ddx, vec2 ddy, float l)'
    )
    const bodyStart = terrainDetailFunctions.indexOf('vec4 sampleDetiled(')
    const bodyEnd = terrainDetailFunctions.indexOf('\n  }', bodyStart)
    const body = terrainDetailFunctions.slice(bodyStart, bodyEnd)

    expect(body).toContain('floor(l)')
    expect(body).toContain('fract(l)')
    expect(body).toContain('smoothstep(')
    expect(body).toContain('texture2DGradEXT(map,')
    // никакого texture2D(map, ...) внутри — иначе прежний мип-шов не лечится
    expect(body).not.toMatch(/texture2D\(map,/)
    // Important ревью: знаковый флип оси убран целиком — сдвиг уже даёт декорреляцию,
    // а флип зеркалил тангенс-нормаль без компенсации (ложные «вдавленные» ячейки)
    expect(body).not.toContain('flip')
    expect(body).not.toMatch(/-1\.0\s*:\s*1\.0/)
  })

  it('l — непрерывный индекс, считается ОДИН раз на проекционную ось в applyTerrainDetail и делится всеми 4 картами', () => {
    const applyStart = terrainDetailFunctions.indexOf('void applyTerrainDetail(')
    const applyBody = terrainDetailFunctions.slice(applyStart)

    // ровно 3 вызова vnoise в applyTerrainDetail — по одному на проекционную
    // ось l (zy/xz/xy), НЕ на карту (карт четыре — они делят эти три
    // значения). Breakup маски зон (задача 2) переиспользует готовый l.z
    // (см. докстроку чанка «ЗОНЫ МАТЕРИАЛА») — четвёртого вызова нет
    // (фикс-раунд 1: убран дубль вычисления).
    const vnoiseCalls = (applyBody.match(/vnoise\(/g) ?? []).length
    expect(vnoiseCalls).toBe(3)

    // l вычислен раньше первого использования (вызов sampleDetailSet — общий
    // helper обоих наборов зоны, см. «зоны материала по уклону»)
    const lIdx = applyBody.indexOf('vnoise(')
    const firstUseIdx = applyBody.indexOf('sampleDetailSet(')
    expect(lIdx).toBeGreaterThan(-1)
    expect(firstUseIdx).toBeGreaterThan(-1)
    expect(lIdx).toBeLessThan(firstUseIdx)

    // общий l передаётся во все четыре вызова *Detiled-обёртки: три — внутри
    // sampleDetailSet (родной/steep набор читает его же тело параметризованно),
    // один — мелкая шкала (fade2-ветка, вне зон). Область поиска — от
    // sampleDetailSet и дальше, иначе сигнатуры sampleDetiled/triplanar*Detiled
    // (тоже заканчиваются на «vec3 l)») ложно засчитываются как вызовы.
    const helperStart = terrainDetailFunctions.indexOf('void sampleDetailSet(')
    const tail = terrainDetailFunctions.slice(helperStart)
    const lPassedCount = (tail.match(/Detiled\([^)]*\bl\)/g) ?? []).length
    expect(lPassedCount).toBe(4)
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

  it('сигнатура applyTerrainDetail совпадает с интерфейсом брифа задачи 2 (+ slopeTan для маски зон)', () => {
    expect(terrainDetailFunctions).toContain(
      'void applyTerrainDetail(inout vec3 nLocal, inout vec3 albedoMul, vec3 dirLocal, vec3 detailPos, vec3 detailPos2, float viewDistance, float slopeTan)'
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
    const callIdx = frag.indexOf(
      'applyTerrainDetail(nLocal, albedoMul, dirLocal, vDetailPos, vDetailPos2, length(vViewPosition), terrainSlopeTan)'
    )
    const finalIdx = frag.indexOf('normal = normalize(normalMatrix * nLocal);')
    expect(callIdx).toBeGreaterThan(-1)
    expect(finalIdx).toBeGreaterThan(-1)
    expect(callIdx).toBeLessThan(finalIdx)
  })

  it('albedoMul применяется на месте выборки dayColor', () => {
    // Выборка диффуза живёт в ветках UV (по одной на ветку), dayColor берёт
    // готовый diffuseSample — и уже он домножается на albedoMul.
    const dayColorIdx = frag.indexOf('vec3 dayColor = diffuseSample;')
    const sampleIdx = frag.indexOf('vec3 diffuseSample = texture2D(diffuseMap, uv).rgb;')
    const mulIdx = frag.indexOf('dayColor *= albedoMul;')
    expect(sampleIdx).toBeGreaterThan(-1)
    expect(dayColorIdx).toBeGreaterThan(sampleIdx)
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

  it('detailScaleMeters: 0 (мусорная ручка) — тот же uDetailScale, что и дефолт (validPeriodMeters в PlanetShader)', () => {
    const stub = {
      renderingObject: { getAttribute: () => ({ emission: 1, bumpScale: 0, detailScaleMeters: 0, detailScale2Meters: 0 }) },
      physicalObject: { getAttribute: () => 1737 },
      children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
      resources: { where: () => ({ first: () => undefined }) }
    } as unknown as Actor

    const material = new PlanetMaterial(stub)

    expect(material.uniforms.uDetailScale.value).toBeCloseTo(1 / toThreeJSUnits(40 / 1000), 10)
    expect(material.uniforms.uDetailScale2.value).toBeCloseTo(1 / toThreeJSUnits(7 / 1000), 10)
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
