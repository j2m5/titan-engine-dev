import { afterEach, describe, expect, it } from 'vitest'
import { Object3D, Texture } from 'three'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { WaterShader } from '@/core/materials/shaders/WaterShader'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { Actor } from '@/core/models/Actor'
import { AtmosphereEntry, AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { resourceStorage } from '@/core/services/ResourceStorage'

// Земля (actorId 7) и её дочерняя атмосфера (actorId 47) — те же реальные
// данные БД, что в tests/planet/SunTintWiring.spec.ts.
const EARTH_ACTOR_ID = 7
const ATMO_ACTOR_ID = 47
const MOON_ACTOR_ID = 19

const TINT_LINE =
  'color *= mix(vec3(1.0), sunTint(dot(normalize(vLocalDir), -normalize(vLocalLightDirection))), uSunTintStrength);'
const FRAG_COLOR_LINE = 'gl_FragColor = vec4(color, alpha);'

const frag: string = WaterShaderTemplate.fragmentShader
const vert: string = WaterShaderTemplate.vertexShader

/** Стоит ли фрагмент под открытым `#ifdef USE_SUN_TINT` (между гейтом и ним нет `#endif`). */
function gatedBySunTint(source: string, needle: string): boolean {
  const index = source.indexOf(needle)

  if (index < 0) return false

  const before = source.slice(0, index)
  const gate = before.lastIndexOf('#ifdef USE_SUN_TINT')

  return gate >= 0 && !before.slice(gate).includes('#endif')
}

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

function stubActor(data: Record<string, unknown>): Actor {
  return {
    renderingObject: { getAttribute: () => data },
    resources: { where: () => ({ first: () => undefined }) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    physicalObject: { getAttribute: () => 6371 }
  } as unknown as Actor
}

describe('WaterShaderTemplate: тинт солнца — контракт шейдера', () => {
  it('вершинник считает vLocalLightDirection ТЕМИ ЖЕ строками, что палуба', () => {
    const planetVert: string = PlanetShaderTemplate.vertexShader
    const worldLightLine = /vec3 worldLightDirection = [^;]+;/.exec(planetVert)?.[0]
    const localLightLine = /vec3 localLightDirection = [^;]+;/.exec(planetVert)?.[0]

    expect(worldLightLine).toBeDefined()
    expect(localLightLine).toBeDefined()
    expect(vert).toContain(worldLightLine!)
    expect(vert).toContain(localLightLine!)
    expect(vert).toContain('varying vec3 vLocalLightDirection;')
    expect(vert).toContain('vLocalLightDirection = localLightDirection;')
    expect(frag).toContain('varying vec3 vLocalLightDirection;')
  })

  it('тинт домножает ИТОГОВЫЙ цвет — последним выражением перед gl_FragColor', () => {
    const tintIndex = frag.indexOf(TINT_LINE)
    const fragColorIndex = frag.indexOf(FRAG_COLOR_LINE)

    expect(tintIndex).toBeGreaterThan(-1)
    expect(fragColorIndex).toBeGreaterThan(tintIndex)
    // Между тинтом и записью цвета — только закрытие его же гейта.
    expect(frag.slice(tintIndex + TINT_LINE.length, fragColorIndex).replace(/\s+/g, '')).toBe('#endif')
  })

  it('тинт и оба чанка стоят под гейтом USE_SUN_TINT', () => {
    expect(gatedBySunTint(frag, TINT_LINE)).toBe(true)
    expect(gatedBySunTint(frag, '#include <sunTransmittanceUniforms>')).toBe(true)
    expect(gatedBySunTint(frag, '#include <sunTransmittanceFunctions>')).toBe(true)
  })

  it('чанки зарегистрированы — имена включений резолвятся в реальный код', () => {
    const shader = new WaterShader(stubActor({}))

    expect(shader.fragmentShader).toContain('uniform sampler2D uAtmoTransmittance;')
    expect(shader.fragmentShader).toContain('vec3 sunTint(float muS)')
    expect(shader.fragmentShader).not.toContain('#include <sunTransmittance')
  })
})

describe('WaterShader: юниформы тинта (дефолты и кламп ручки)', () => {
  it('дефолты: сэмплер null, геометрия нулевая, сила ручки 1 (нейтрально — гейтит эффект дефайн)', () => {
    const shader = new WaterShader(stubActor({}))

    expect(shader.uniforms.uAtmoTransmittance.value).toBeNull()
    expect(shader.uniforms.uAtmoBottomRadius.value).toBe(0)
    expect(shader.uniforms.uAtmoTopRadius.value).toBe(0)
    expect(shader.uniforms.uAtmoSunAngularRadius.value).toBe(0)
    expect(shader.uniforms.uAtmoDatumRadius.value).toBe(0)
    expect(shader.uniforms.uSunTintStrength.value).toBe(1)
  })

  it('ручка sunTintStrength — та же, что у суши, и клампится к [0,1]', () => {
    expect(new WaterShader(stubActor({ sunTintStrength: 0.4 })).uniforms.uSunTintStrength.value).toBe(0.4)
    expect(new WaterShader(stubActor({ sunTintStrength: 2 })).uniforms.uSunTintStrength.value).toBe(1)
    expect(new WaterShader(stubActor({ sunTintStrength: -1 })).uniforms.uSunTintStrength.value).toBe(0)
  })
})

describe('WaterMaterial.syncSunTint: запись реестра → дефайн и юниформы', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  function earth(): Actor {
    return Actor.find(EARTH_ACTOR_ID)!
  }

  it('запись есть → дефайн, LUT по ссылке, датум из physicalObject', () => {
    const registry = new AtmosphereRegistry()
    const e = entry()
    registry.register(e)
    const material = new WaterMaterial(earth(), null, registry)

    material.syncSunTint()

    expect(material.defines.USE_SUN_TINT).toBe('1')
    expect(material.uniforms.uAtmoTransmittance.value).toBe(e.lut.transmittance)
    expect(material.uniforms.uAtmoBottomRadius.value).toBe(6351.8)
    expect(material.uniforms.uAtmoTopRadius.value).toBe(6420)
    expect(material.uniforms.uAtmoSunAngularRadius.value).toBe(0.004)
    expect(material.uniforms.uAtmoDatumRadius.value).toBe(earth().physicalObject!.getAttribute('radius'))
  })

  it('записи нет — дефайна нет', () => {
    const material = new WaterMaterial(earth(), null, new AtmosphereRegistry())

    material.syncSunTint()

    expect(material.defines.USE_SUN_TINT).toBeUndefined()
  })

  it('без реестра (легаси-вызов) — no-op', () => {
    const material = new WaterMaterial(earth())

    material.syncSunTint()

    expect(material.defines.USE_SUN_TINT).toBeUndefined()
  })

  it('тело без атмосферы (Луна, actor 19) — no-op', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const material = new WaterMaterial(Actor.find(MOON_ACTOR_ID)!, null, registry)

    material.syncSunTint()

    expect(material.defines.USE_SUN_TINT).toBeUndefined()
  })

  it('смена гейта USE_WATER_DEPTH (стриминг slope) не теряет дефайн тинта', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const material = new WaterMaterial(earth(), null, registry)

    material.syncSunTint()

    const slopePath = earth().resources.where('resourceType', 'slope').first()!.getAttribute('path') as string
    const slopeTexture = new Texture()
    slopeTexture.name = slopePath
    slopeTexture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(slopeTexture)
    material.updateMaterial()

    expect(material.defines.USE_WATER_DEPTH).toBe('1')
    expect(material.defines.USE_SUN_TINT).toBe('1')
  })

  it('resetMaterial сбрасывает дефайн, следующий syncSunTint возвращает его', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const material = new WaterMaterial(earth(), null, registry)

    material.syncSunTint()
    material.resetMaterial()

    expect(material.defines.USE_SUN_TINT).toBeUndefined()
    expect(material.uniforms.uAtmoTransmittance.value).toBeNull()

    material.syncSunTint()

    expect(material.defines.USE_SUN_TINT).toBe('1')
  })
})
