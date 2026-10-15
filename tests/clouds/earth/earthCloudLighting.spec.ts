import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Uniform } from 'three'
import { createEarthAtmosphere, createEarthClouds, setEarthCloudQuality } from '@/labs/earth-clouds/EarthCloudAdapter'
import { bindEarthCloudLighting, adaptEarthCloudLightingShader } from '@/labs/earth-clouds/earthCloudLighting'
import { bindCloudAppearance } from '@/labs/jupiter-clouds/cloudAppearance'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import { DataTexture } from 'three'

const anchor = 'return vec4(radianceIntegral, remapClamped(transmittanceIntegral, 1.0, minTransmittance));'
const effect = () => createEarthClouds(new PerspectiveCamera(), createEarthAtmosphere().atmosphere)
describe('Earth cloud lighting reference', () => {
  it('normalizes once after integration on the real pinned cloud shader and preserves quality changes', () => {
    const clouds = effect(),
      other = effect()
    const material = clouds.cloudsPass.currentMaterial
    const original = material.fragmentShader,
      shadow = clouds.shadowPass.currentMaterial.fragmentShader
    const otherSource = other.cloudsPass.currentMaterial.fragmentShader
    const restore = bindEarthCloudLighting(clouds, 6360000)
    try {
      expect(material.uniforms.earthLightingDatumKm?.value).toBe(6360)
      const shader = material.fragmentShader
      expect(shader.startsWith('uniform highp float earthLightingDatumKm;')).toBe(true)
      expect(shader.split('radianceIntegral /= earthCloudReferenceWhite;')).toHaveLength(2)
      expect(shader.indexOf('radianceIntegral /= earthCloudReferenceWhite;')).toBeLessThan(shader.indexOf(anchor))
      expect(shader.indexOf('radianceIntegral /= earthCloudReferenceWhite;')).toBeGreaterThan(
        shader.indexOf('radianceIntegral += ')
      )
      expect(clouds.shadowPass.currentMaterial.fragmentShader).toBe(shadow)
      expect(other.cloudsPass.currentMaterial.fragmentShader).toBe(otherSource)
      for (const quality of ['low', 'high', 'medium'] as const) {
        setEarthCloudQuality(clouds, quality)
        expect(material.fragmentShader).toBe(shader)
        expect(material.uniforms.earthLightingDatumKm.value).toBe(6360)
      }
      expect(() => bindEarthCloudLighting(clouds, 6360000)).toThrow(/already|duplicate/i)
      expect(material.fragmentShader).toBe(shader)
    } finally {
      restore()
      restore()
      expect(material.fragmentShader).toBe(original)
      expect(Object.hasOwn(material.uniforms, 'earthLightingDatumKm')).toBe(false)
      clouds.dispose()
      other.dispose()
    }
  })
  it('rejects missing and duplicate anchors or invalid datum without partial mutation', () => {
    const clouds = effect(),
      material = clouds.cloudsPass.currentMaterial
    const original = material.fragmentShader,
      uniforms = { ...material.uniforms }
    try {
      for (const datum of [0, -1, NaN, Infinity]) expect(() => bindEarthCloudLighting(clouds, datum)).toThrow(/datum/i)
      expect(material.fragmentShader).toBe(original)
      for (const bad of [original.replace(anchor, ''), original + anchor]) {
        material.fragmentShader = bad
        expect(() => bindEarthCloudLighting(clouds, 6360000)).toThrow(/expected one|anchor/i)
        expect(material.fragmentShader).toBe(bad)
        expect(material.uniforms).toEqual(uniforms)
      }
      const adapted = adaptEarthCloudLightingShader(original)
      expect(() => adaptEarthCloudLightingShader(adapted)).toThrow(/already|duplicate/i)
    } finally {
      clouds.dispose()
    }
  })
  it('restores prior uniform identity and nested appearance shader in reverse order', () => {
    const clouds = effect(),
      material = clouds.cloudsPass.currentMaterial
    const original = material.fragmentShader
    const prior = new Uniform(123)
    material.uniforms.earthLightingDatumKm = prior
    const weather = new DataTexture()
    const appearance = bindCloudAppearance(clouds, createEarthCloudProfile(), {
      weather,
      color: null,
      constantColorLinear: [1, 1, 1],
      colorStrength: 1,
      dispose() {}
    })
    const appearanceShader = material.fragmentShader
    const restore = bindEarthCloudLighting(clouds, 6360000)
    expect(material.uniforms.earthLightingDatumKm).not.toBe(prior)
    expect(material.fragmentShader).not.toBe(appearanceShader)
    restore()
    restore()
    expect(material.uniforms.earthLightingDatumKm).toBe(prior)
    expect(material.fragmentShader).toBe(appearanceShader)
    appearance.dispose()
    expect(material.fragmentShader).toBe(original)
    const nextRestore = bindEarthCloudLighting(clouds, 6360000)
    nextRestore()
    expect(material.uniforms.earthLightingDatumKm).toBe(prior)
    weather.dispose()
    clouds.dispose()
  })
})
