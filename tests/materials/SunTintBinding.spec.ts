import { describe, expect, it } from 'vitest'
import { Object3D, Texture } from 'three'
import { SunTintBinding, SunTintTarget } from '@/core/materials/SunTintBinding'
import { AtmosphereEntry, AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'

const ATMO_ACTOR_ID = 47
const DATUM_RADIUS_KM = 6371

/** Подогнанный конфиг (bottomRadius уже сдвинут terrainFloorAdjust) — проводка обязана брать радиусы ИЗ записи. */
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

/**
 * Голая цель проводки вместо ShaderMaterial: needsUpdate у three — сеттер без
 * геттера (пишет version++), а здесь нужно читать сам факт записи.
 */
function target(): SunTintTarget {
  return {
    uniforms: {
      uAtmoTransmittance: { value: null },
      uAtmoBottomRadius: { value: 0 },
      uAtmoTopRadius: { value: 0 },
      uAtmoSunAngularRadius: { value: 0 },
      uAtmoDatumRadius: { value: 0 }
    },
    defines: {},
    needsUpdate: false
  }
}

describe('SunTintBinding: запись реестра → дефайн и юниформы', () => {
  it('запись есть → дефайн, подогнанные радиусы, LUT по ссылке, датум конструктора', () => {
    const registry = new AtmosphereRegistry()
    const e = entry()
    registry.register(e)
    const material = target()
    const binding = new SunTintBinding(material, registry, ATMO_ACTOR_ID, DATUM_RADIUS_KM)

    binding.sync()

    expect(binding.active).toBe(true)
    expect(material.defines.USE_SUN_TINT).toBe('1')
    expect(material.needsUpdate).toBe(true)
    expect(material.uniforms.uAtmoTransmittance.value).toBe(e.lut.transmittance)
    expect(material.uniforms.uAtmoBottomRadius.value).toBe(6351.8)
    expect(material.uniforms.uAtmoTopRadius.value).toBe(6420)
    expect(material.uniforms.uAtmoSunAngularRadius.value).toBe(0.004)
    expect(material.uniforms.uAtmoDatumRadius.value).toBe(DATUM_RADIUS_KM)
  })

  it('та же запись повторно — needsUpdate не трогается (рекомпила нет)', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const material = target()
    const binding = new SunTintBinding(material, registry, ATMO_ACTOR_ID, DATUM_RADIUS_KM)

    binding.sync()
    material.needsUpdate = false
    binding.sync()
    binding.sync()

    expect(material.needsUpdate).toBe(false)
    expect(material.defines.USE_SUN_TINT).toBe('1')
  })

  it('запись снята → дефайн ушёл, сэмплер null, прежний объект дефайнов не мутирован', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const material = target()
    const binding = new SunTintBinding(material, registry, ATMO_ACTOR_ID, DATUM_RADIUS_KM)

    binding.sync()

    const definesWithTint = material.defines

    registry.unregister(ATMO_ACTOR_ID)
    binding.sync()

    expect(binding.active).toBe(false)
    expect(material.defines.USE_SUN_TINT).toBeUndefined()
    expect(material.uniforms.uAtmoTransmittance.value).toBeNull()
    // Прежний объект мог уйти в ключ программы — снятие ключа только копией.
    expect(definesWithTint.USE_SUN_TINT).toBe('1')
  })

  it('радиус датума 0 — неактивно, даже если запись в реестре есть', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const material = target()
    const binding = new SunTintBinding(material, registry, ATMO_ACTOR_ID, 0)

    binding.sync()

    expect(binding.active).toBe(false)
    expect(material.defines.USE_SUN_TINT).toBeUndefined()
  })

  it('без реестра (легаси-вызов) и без актора атмосферы — no-op', () => {
    const withoutRegistry = target()
    new SunTintBinding(withoutRegistry, undefined, ATMO_ACTOR_ID, DATUM_RADIUS_KM).sync()

    const withoutAtmosphere = target()
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    new SunTintBinding(withoutAtmosphere, registry, undefined, DATUM_RADIUS_KM).sync()

    expect(withoutRegistry.defines.USE_SUN_TINT).toBeUndefined()
    expect(withoutAtmosphere.defines.USE_SUN_TINT).toBeUndefined()
  })

  it('reset — неактивно и сэмплер null, следующий sync возвращает дефайн', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry())
    const material = target()
    const binding = new SunTintBinding(material, registry, ATMO_ACTOR_ID, DATUM_RADIUS_KM)

    binding.sync()
    binding.reset()

    expect(binding.active).toBe(false)
    expect(material.uniforms.uAtmoTransmittance.value).toBeNull()

    binding.sync()

    expect(binding.active).toBe(true)
    expect(material.defines.USE_SUN_TINT).toBe('1')
  })
})
