import { afterEach, describe, expect, it, vi } from 'vitest'
import { Object3D, Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { AtmosphereRegistry, type AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { resourceStorage } from '@/core/services/ResourceStorage'

function atmosphere(): AtmosphereEntry {
  return {
    actorId: 47, name: 'EarthAtmosphere', object: new Object3D(),
    config: {
      solarIrradiance: [1.474, 1.8504, 1.91198], sunAngularRadius: 0.004,
      bottomRadius: 6351.8, topRadius: 6420,
      rayleighDensity: [EMPTY_LAYER, expLayer(8)], rayleighScattering: [0.0058, 0.0135, 0.0331],
      mieDensity: [EMPTY_LAYER, expLayer(1.2)], mieScattering: [0.004, 0.004, 0.004],
      mieExtinction: [0.0044, 0.0044, 0.0044], miePhaseFunctionG: 0.8,
      absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER], absorptionExtinction: [0, 0, 0],
      groundAlbedo: [0.1, 0.1, 0.1], muSMin: -0.2, exposure: 6, hdrKnee: 0.7
    },
    lut: { transmittance: new Texture(), scattering: new Texture(), irradiance: new Texture() }
  }
}

describe('water sky reflection lifecycle', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  it('borrows the matching atmosphere and preserves its gate when resources arrive', () => {
    const registry = new AtmosphereRegistry()
    const material = new WaterMaterial(Actor.find(7)!, null, registry)
    material.syncSunTint()
    expect(material.defines.USE_WATER_SKY).toBeUndefined()
    const entry = atmosphere()
    registry.register(entry)
    material.syncSunTint()
    expect(material.defines.USE_WATER_SKY).toBe('1')
    expect(material.uniforms.uWaterSkyScattering.value).toBe(entry.lut.scattering)
    expect(material.uniforms.uWaterSkyRayleigh.value.toArray()).toEqual(entry.config.rayleighScattering)
    expect(material.uniforms.uWaterSkyMie.value.toArray()).toEqual(entry.config.mieScattering)
    expect(material.uniforms.uWaterSkyMieG.value).toBe(0.8)
    expect(material.uniforms.uWaterSkyExposure.value).toBe(6)
    expect(material.uniforms.uWaterSkyHdrKnee.value).toBe(0.7)
    const version = material.version
    material.syncSunTint()
    expect(material.version).toBe(version)
    material.syncClouds(new Texture(), 1)
    expect(material.defines.USE_WATER_SKY).toBe('1')
    expect(material.defines.USE_SUN_TINT).toBe('1')
    expect(material.defines.USE_WATER_CLOUD).toBe('1')
    expect(material.defines.USE_WATER_REFLECTION).toBeUndefined()
    material.dispose()
  })

  it('updates display controls without recompilation and replaces rebuilt LUTs', () => {
    const registry = new AtmosphereRegistry()
    const entry = atmosphere()
    registry.register(entry)
    const material = new WaterMaterial(Actor.find(7)!, null, registry)
    material.syncSunTint()
    const version = material.version
    entry.config.exposure = 3
    entry.config.hdrKnee = -1
    material.syncSunTint()
    expect(material.uniforms.uWaterSkyExposure.value).toBe(3)
    expect(material.uniforms.uWaterSkyHdrKnee.value).toBe(0)
    expect(material.version).toBe(version)
    const rebuilt = atmosphere()
    registry.register(rebuilt)
    material.syncSunTint()
    expect(material.uniforms.uWaterSkyScattering.value).toBe(rebuilt.lut.scattering)
    material.dispose()
  })

  it('clears stale samplers on removal/reset and never disposes borrowed textures', () => {
    const registry = new AtmosphereRegistry()
    const entry = atmosphere()
    const disposed = vi.spyOn(entry.lut.scattering, 'dispose')
    registry.register(entry)
    const material = new WaterMaterial(Actor.find(7)!, null, registry)
    material.syncSunTint()
    material.resetMaterial()
    expect(material.defines.USE_WATER_SKY).toBeUndefined()
    expect(material.uniforms.uWaterSkyScattering.value).toBeNull()
    material.syncSunTint()
    expect(material.defines.USE_WATER_SKY).toBe('1')
    registry.unregister(47)
    material.syncSunTint()
    expect(material.defines.USE_WATER_SKY).toBeUndefined()
    expect(material.uniforms.uWaterSkyScattering.value).toBeNull()
    material.dispose()
    expect(disposed).not.toHaveBeenCalled()
  })
})
