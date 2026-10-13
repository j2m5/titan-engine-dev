import { describe, expect, it, vi } from 'vitest'
import { CloudsEffect } from '@takram/three-clouds'
import { DataTexture, RGBAFormat, SRGBColorSpace, PerspectiveCamera, Quaternion, Vector3, Texture } from 'three'
import { validCloudConfig } from './cloudFixtures'
import { resolveCloudConfig } from '@/core/clouds/validateCloudConfig'
import { prepareCloudAppearanceTextures } from '@/labs/jupiter-clouds/cloudAppearanceTextures'
import { assertCloudAppearanceSupport, bindCloudAppearance } from '@/labs/jupiter-clouds/cloudAppearance'

const source = () =>
  new DataTexture(
    new Uint8Array([32, 64, 96, 255, 192, 224, 255, 255, 64, 96, 128, 255, 224, 255, 128, 255]),
    2,
    2,
    RGBAFormat
  )
describe('cloud appearance', () => {
  it('rejects independently valid mask and multiple layer profiles', () => {
    const config = validCloudConfig()
    const pattern = config.layers[0].pattern
    if (pattern.kind !== 'appearance') throw new Error('fixture')
    config.farAppearance = 'separate-layer'
    config.layers[0].pattern = { kind: 'mask', map: pattern.map, decode: pattern.decode }
    expect(resolveCloudConfig(config, new Set([32])).state).toBe('configured')
    expect(() => assertCloudAppearanceSupport(config)).toThrow(/unsupported/i)
    const multiple = validCloudConfig()
    multiple.layers.push({ ...multiple.layers[0], id: 'second' })
    expect(() => assertCloudAppearanceSupport(multiple)).toThrow(/unsupported/i)
  })
  it('owns only derived textures and preserves shared source parameters', () => {
    const original = source()
    original.colorSpace = SRGBColorSpace
    const before = {
      colorSpace: original.colorSpace,
      wrapS: original.wrapS,
      flipY: original.flipY,
      image: original.image
    }
    const spy = vi.spyOn(original, 'dispose')
    const maps = prepareCloudAppearanceTextures(validCloudConfig().layers[0], () => original)
    expect(maps.color).not.toBe(original)
    expect(maps.color?.source).toBe(original.source)
    const weatherDispose = vi.spyOn(maps.weather, 'dispose')
    const colorDispose = vi.spyOn(maps.color!, 'dispose')
    maps.dispose()
    maps.dispose()
    expect(weatherDispose).toHaveBeenCalledTimes(1)
    expect(colorDispose).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalled()
    expect({
      colorSpace: original.colorSpace,
      wrapS: original.wrapS,
      flipY: original.flipY,
      image: original.image
    }).toEqual(before)
    spy.mockRestore()
    original.dispose()
  })
  it.each([false, true])('matches source sampling row orientation flipY=%s', (flipY) => {
    const original = source()
    original.flipY = flipY
    const config = validCloudConfig()
    const pattern = config.layers[0].pattern
    if (pattern.kind !== 'appearance') throw new Error('fixture')
    pattern.decode.channel = 'r'
    pattern.decode.sampleSpace = 'linear'
    pattern.coverageRange = [0, 1]
    const maps = prepareCloudAppearanceTextures(config.layers[0], () => original)
    expect(Array.from(maps.weather.image.data as Uint8Array).filter((_, i) => i % 4 === 0)).toEqual(
      flipY ? [64, 224, 32, 192] : [32, 192, 64, 224]
    )
    expect(maps.weather.flipY).toBe(false)
    maps.dispose()
    original.dispose()
  })
  it('diagnoses missing, unreadable, unloaded and unknown-space resources', () => {
    const layer = validCloudConfig().layers[0]
    expect(() => prepareCloudAppearanceTextures(layer, () => undefined)).toThrow(/resource/i)
    const original: Texture = source()
    original.image = null
    expect(() => prepareCloudAppearanceTextures(layer, () => original)).toThrow(/image/i)
    original.image = { width: 0, height: 0 }
    expect(() => prepareCloudAppearanceTextures(layer, () => original)).toThrow(/loaded|image/i)
    const unknown = source()
    unknown.colorSpace = 'unknown'
    expect(() => prepareCloudAppearanceTextures(layer, () => unknown)).toThrow(/colorSpace/i)
    layer.color = { kind: 'map', map: { resourceId: 33 }, strength: 1 }
    expect(() => prepareCloudAppearanceTextures(layer, (id) => (id === 32 ? source() : undefined))).toThrow(/33/)
  })
  it('binds deterministic seed and physical units without changing config or owning textures', () => {
    const config = validCloudConfig()
    config.layers[0].detail.seed = 0
    const before = structuredClone(config)
    const original = source()
    const maps = prepareCloudAppearanceTextures(config.layers[0], () => original)
    const effects = [new CloudsEffect(new PerspectiveCamera()), new CloudsEffect(new PerspectiveCamera())]
    effects[1].qualityPreset = 'low'
    const bindings = effects.map((effect) => bindCloudAppearance(effect, config, maps))
    expect(effects[0].shapeOffset.toArray()).toEqual(effects[1].shapeOffset.toArray())
    expect(effects[0].shapeOffset.length()).toBeGreaterThan(0)
    expect(effects[0].scatteringCoefficient).toBe(config.layers[0].extinctionPerMeter)
    expect(effects[0].absorptionCoefficient).toBe(0)
    bindings[0].setPlanetRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))
    expect(effects[0].cloudsPass.currentMaterial.uniforms.cloudECEFToPlanet).toBe(
      effects[0].shadowPass.currentMaterial.uniforms.cloudECEFToPlanet
    )
    const spy = vi.spyOn(maps.weather, 'dispose')
    bindings.forEach((binding) => {
      binding.dispose()
      binding.dispose()
    })
    expect(spy).not.toHaveBeenCalled()
    expect(config).toEqual(before)
    maps.dispose()
    original.dispose()
    effects.forEach((effect) => effect.dispose())
  })
  it('rejects a mismatched shadow shader atomically', () => {
    const effect = new CloudsEffect(new PerspectiveCamera())
    const shadow = effect.shadowPass.currentMaterial
    shadow.fragmentShader = shadow.fragmentShader.replace('vec2 getGlobeUv', 'vec2 obsoleteGlobeUv')
    const materials = [effect.cloudsPass.currentMaterial, shadow]
    const before = materials.map((material) => ({
      shader: material.fragmentShader,
      uniforms: { ...material.uniforms },
      version: material.version
    }))
    const original = source()
    const maps = prepareCloudAppearanceTextures(validCloudConfig().layers[0], () => original)
    expect(() => bindCloudAppearance(effect, validCloudConfig(), maps)).toThrow(/shadow.*getGlobeUv/i)
    materials.forEach((material, i) => {
      expect(material.fragmentShader).toBe(before[i].shader)
      expect(material.uniforms).toEqual(before[i].uniforms)
      expect(material.version).toBe(before[i].version)
    })
    maps.dispose()
    original.dispose()
    effect.dispose()
  })
  it('rejects duplicated anchors and restores both materials on detach', () => {
    const effect = new CloudsEffect(new PerspectiveCamera())
    const original = source()
    const maps = prepareCloudAppearanceTextures(validCloudConfig().layers[0], () => original)
    const material = effect.cloudsPass.currentMaterial
    const before = material.fragmentShader
    material.fragmentShader += '\nvec2 getGlobeUv(const vec3 position) { return vec2(0.); }'
    expect(() => bindCloudAppearance(effect, validCloudConfig(), maps)).toThrow(/cloud.*getGlobeUv/i)
    material.fragmentShader = before
    const shadowBefore = effect.shadowPass.currentMaterial.fragmentShader
    const binding = bindCloudAppearance(effect, validCloudConfig(), maps)
    binding.dispose()
    expect(material.fragmentShader).toBe(before)
    expect(effect.shadowPass.currentMaterial.fragmentShader).toBe(shadowBefore)
    expect(material.uniforms.cloudColorTexture).toBeUndefined()
    maps.dispose()
    original.dispose()
    effect.dispose()
  })
  it('converts constant sRGB to linear without allocating a color texture', () => {
    const config = validCloudConfig()
    config.layers[0].color = { kind: 'constant', srgb: [0.5, 0, 1] }
    const original = source()
    const maps = prepareCloudAppearanceTextures(config.layers[0], () => original)
    expect(maps.color).toBeNull()
    expect(maps.constantColorLinear[0]).toBeCloseTo(0.21404114, 6)
    expect(maps.constantColorLinear.slice(1)).toEqual([0, 1])
    expect(maps.colorStrength).toBe(1)
    maps.dispose()
    original.dispose()
  })
})
