import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Object3D, Texture } from 'three'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { AtmosphereRegistry, AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { Actor } from '@/core/models/Actor'
import { ResourceType } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { EMPTY_LAYER, expLayer, AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'

// Земля (actorId 7) и её дочерняя атмосфера (actorId 47, categoryId 5) — те же
// реальные данные БД, что в PlanetCloudOpacity.spec.ts.
const EARTH_ACTOR_ID = 7
const ATMO_ACTOR_ID = 47
const MOON_ACTOR_ID = 19

function earth(): Actor {
  return Actor.find(EARTH_ACTOR_ID)!
}

function diffusePathOf(actor: Actor): string {
  return actor.resources.where('resourceType', 'diffuse' as ResourceType).first()!.getAttribute('path') as string
}

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

/**
 * `getTextureOrMake` при промахе строит PlaceholderTexture (канвас 2d
 * недоступен в jsdom) — тот же приём, что seedPlaceholderKeys в
 * PlanetMaterialMaps.spec.ts: сеем все ключи, по которым материал ходит через
 * getTextureOrMake.
 */
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(diffusePathOf(earth()))
  seedTexture(diffusePathOf(Actor.find(MOON_ACTOR_ID)!))
}

// Подогнанный конфиг (bottomRadius уже сдвинут terrainFloorAdjust — 6351.8
// вместо 6360 из БД): проводка обязана брать значения ИЗ ЗАПИСИ реестра, а не
// перечитывать сырую строку атмосферы.
function config(): AtmosphereConfig {
  return {
    solarIrradiance: [1.474, 1.8504, 1.91198],
    sunAngularRadius: 0.004,
    bottomRadius: 6351.8,
    topRadius: 6420,
    rayleighDensity: [EMPTY_LAYER, expLayer(8)],
    rayleighScattering: [0.0058, 0.0135, 0.0331],
    mieDensity: [EMPTY_LAYER, expLayer(1.2)],
    mieScattering: [0.004, 0.004, 0.004],
    mieExtinction: [0.0044, 0.0044, 0.0044],
    miePhaseFunctionG: 0.8,
    absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
    absorptionExtinction: [0, 0, 0],
    groundAlbedo: [0.1, 0.1, 0.1],
    muSMin: -0.2
  }
}

function entry(): AtmosphereEntry {
  return {
    actorId: ATMO_ACTOR_ID,
    name: 'EarthAtmosphere',
    object: new Object3D(),
    config: config(),
    lut: { transmittance: new Texture(), scattering: new Texture(), irradiance: new Texture() }
  }
}

describe('PlanetMaterial.syncSunTint: запись реестра → дефайн и юниформы', () => {
  beforeEach(seedPlaceholderKeys)
  afterEach(() => resourceStorage.deleteAllTextures())

  it('без записи дефайна нет', () => {
    const m = new PlanetMaterial(earth(), new AtmosphereRegistry())

    m.updateMaterial()
    m.syncSunTint()
    expect(m.defines.USE_SUN_TINT).toBeUndefined()
  })

  it('запись появилась → дефайн, подогнанные радиусы, LUT по ссылке, датум из physicalObject', () => {
    const registry = new AtmosphereRegistry()
    const e = entry()
    registry.register(e)
    const m = new PlanetMaterial(earth(), registry)

    m.updateMaterial()
    // needsUpdate у three — сеттер без геттера (пишет version++), поэтому
    // рекомпил проверяется по самому version.
    const versionBefore = m.version
    m.syncSunTint()
    expect(m.defines.USE_SUN_TINT).toBe('1')
    expect(m.version).toBeGreaterThan(versionBefore)
    expect(m.uniforms.uAtmoTransmittance.value).toBe(e.lut.transmittance)
    expect(m.uniforms.uAtmoBottomRadius.value).toBe(6351.8)
    expect(m.uniforms.uAtmoTopRadius.value).toBe(6420)
    expect(m.uniforms.uAtmoSunAngularRadius.value).toBe(0.004)
    expect(m.uniforms.uAtmoDatumRadius.value).toBe(earth().physicalObject!.getAttribute('radius'))
  })

  it('та же запись повторно — рекомпила нет', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const m = new PlanetMaterial(earth(), registry)

    m.updateMaterial()
    m.syncSunTint()

    const versionAfterFirst = m.version
    m.syncSunTint()
    m.syncSunTint()
    expect(m.version).toBe(versionAfterFirst)
  })

  it('запись снята → дефайн ушёл, сэмплер null', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const m = new PlanetMaterial(earth(), registry)

    m.updateMaterial()
    m.syncSunTint()
    registry.unregister(ATMO_ACTOR_ID)
    m.syncSunTint()
    expect(m.defines.USE_SUN_TINT).toBeUndefined()
    expect(m.uniforms.uAtmoTransmittance.value).toBeNull()
  })

  it('updateMaterial (стриминг карт) не теряет дефайн тинта', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const m = new PlanetMaterial(earth(), registry)

    m.updateMaterial()
    m.syncSunTint()
    m.updateMaterial()
    expect(m.defines.USE_SUN_TINT).toBe('1')
  })

  it('resetMaterial сбрасывает дефайн, следующий syncSunTint возвращает его', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const m = new PlanetMaterial(earth(), registry)

    m.updateMaterial()
    m.syncSunTint()
    m.resetMaterial()
    expect(m.defines.USE_SUN_TINT).toBeUndefined()

    m.syncSunTint()
    expect(m.defines.USE_SUN_TINT).toBe('1')
  })

  it('тело без атмосферы (Луна, actor 19) — no-op', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const m = new PlanetMaterial(Actor.find(MOON_ACTOR_ID)!, registry)

    m.updateMaterial()
    m.syncSunTint()
    expect(m.defines.USE_SUN_TINT).toBeUndefined()
  })

  it('без реестра (легаси-вызов) — no-op', () => {
    const m = new PlanetMaterial(earth())

    m.updateMaterial()
    m.syncSunTint()
    expect(m.defines.USE_SUN_TINT).toBeUndefined()
  })
})
