import { afterEach, describe, expect, it } from 'vitest'
import { Texture, Vector2 } from 'three'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { terrainDetailFunctions, terrainDetailUniforms } from '@/core/materials/shaders/lib/chunks/TerrainDetail'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'
import { DETAIL_TEXTURE_STATS } from '@/core/terrain/detailTextureStats'

/**
 * Нормировка детального слоя к средним файлов: без неё тело темнело по мере
 * вхождения детали (fade по дистанции камеры) — альбедо умножалось на среднюю
 * яркость diff (rocky 0.23) и на средний AO (0.63).
 */
describe('TerrainDetail: нормировка diff/AO к средним набора', () => {
  const fn: string = terrainDetailFunctions

  it('юниформы нормировки объявлены, helper принимает norm и применяет его ДО насыщенности/яркости', () => {
    expect(terrainDetailUniforms).toContain('uniform vec2 uDetailTintNorm;')
    expect(terrainDetailUniforms).toContain('uniform vec2 uSteepTintNorm;')
    const helper = fn.slice(fn.indexOf('void sampleDetailSet('), fn.indexOf('void applyTerrainDetail('))
    expect(helper).toContain('sampler2D diff, vec2 norm,')
    const ao = helper.indexOf('clamp(triplanarArmDetiled(arm, t, w, l).r * norm.y, 0.0, 2.0)')
    const diff = helper.indexOf('clamp(triplanarAlbedoDetiled(diff, t, w, l) * norm.x, 0.0, 2.0)')
    const sat = helper.indexOf('uDetailSaturation) * uDetailBrightness')
    expect(ao).toBeGreaterThan(-1)
    expect(diff).toBeGreaterThan(-1)
    expect(diff).toBeLessThan(sat)
  })

  it('родной набор читается со своей нормировкой, steep — со своей', () => {
    expect(fn).toContain('uDetailDiffMap, uDetailTintNorm, uvBig')
    expect(fn).toContain('uSteepDiffMap, uSteepTintNorm, uvBig')
    // все четыре вызова helper'а несут норму — без параметра ни одного не осталось
    expect(fn).not.toMatch(/uDetailDiffMap, uvBig/)
    expect(fn).not.toMatch(/uSteepDiffMap, uvBig/)
  })
})

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

/** Все ключи, по которым материал ходит через getTextureOrMake (плейсхолдер в jsdom падает на canvas). */
function seedFor(actor: Actor): void {
  for (const name of ['', 'default.png', 'night.jpg']) seedTexture(name)
  for (const resource of actor.resources.all()) seedTexture(resource.getAttribute('path') as string)
  for (const path of Object.values(STEEP_DETAIL_PATHS)) seedTexture(path)
}

describe('PlanetMaterial: uDetailTintNorm/uSteepTintNorm из путей ресурсов', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  it('Луна (rocky_trail родной): родная норма = steep-норма = 1/средние rocky', () => {
    const moon = Actor.find(19)!
    seedFor(moon)
    const material = new PlanetMaterial(moon)
    material.updateMaterial()
    const native = material.uniforms.uDetailTintNorm.value as Vector2
    const steep = material.uniforms.uSteepTintNorm.value as Vector2
    expect(native.x).toBeCloseTo(1 / DETAIL_TEXTURE_STATS[STEEP_DETAIL_PATHS.diffuse]!.meanLum!, 9)
    expect(native.y).toBeCloseTo(1 / DETAIL_TEXTURE_STATS[STEEP_DETAIL_PATHS.arm]!.meanAo!, 9)
    expect(steep.x).toBe(native.x)
    expect(steep.y).toBe(native.y)
  })

  it('Энцелад (ice родной): родная норма — ice, steep — rocky; resetMaterial возвращает 1', () => {
    const enceladus = Actor.find(25)!
    seedFor(enceladus)
    const material = new PlanetMaterial(enceladus)
    material.updateMaterial()
    const native = material.uniforms.uDetailTintNorm.value as Vector2
    const steep = material.uniforms.uSteepTintNorm.value as Vector2
    expect(native.x).toBeCloseTo(1 / DETAIL_TEXTURE_STATS['terrain/ice_diff.webp']!.meanLum!, 9)
    expect(native.y).toBeCloseTo(1 / DETAIL_TEXTURE_STATS['terrain/ice_arm.webp']!.meanAo!, 9)
    expect(steep.x).toBeCloseTo(1 / DETAIL_TEXTURE_STATS[STEEP_DETAIL_PATHS.diffuse]!.meanLum!, 9)
    material.resetMaterial()
    expect(native.x).toBe(1)
    expect(native.y).toBe(1)
    expect(steep.x).toBe(1)
  })
})
