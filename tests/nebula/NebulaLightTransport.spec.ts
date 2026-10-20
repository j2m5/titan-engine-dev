import { Vector3 } from 'three'
import { makeDefaultNebulaParams, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { nebulaParamsFromData, type NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'

describe('nebula light transport controls', () => {
  it('preserves legacy lighting and skips secondary rays by default', () => {
    const p = makeDefaultNebulaParams()
    expect(p.lighting.anisotropy).toBeNull()
    expect(p.lighting.shadowStrength).toBe(0)
    expect(p.quality.lightSteps).toBe(6)
  })

  it('roundtrips JSON through presets and uploads the enabled lighting model', () => {
    const data: NebulaRenderingData = {
      preset: 'reflection', lighting: { anisotropy: 0.45, shadowStrength: 0.8 }, quality: { lightSteps: 9.6 }
    }
    const p = nebulaParamsFromData(JSON.parse(JSON.stringify(data)))
    expect(p.lighting).toMatchObject({ anisotropy: 0.45, shadowStrength: 0.8, ambient: 0.3 })
    expect(p.quality.lightSteps).toBe(10)
    const material = new NebulaRaymarchMaterial(p)
    try {
      expect(material.uniforms.uPhaseHG.value).toBe(1)
      expect(material.uniforms.uAnisotropy.value).toBe(0.45)
      expect(material.uniforms.uShadowStrength.value).toBe(0.8)
      expect(material.uniforms.uLightSteps.value).toBe(10)
      material.setUniformsFromParams(mergeNebulaParams({ lighting: { anisotropy: 0, shadowStrength: 0 } }, p))
      expect(material.uniforms.uPhaseHG.value).toBe(1)
      expect(material.uniforms.uAnisotropy.value).toBe(0)
      expect(material.uniforms.uShadowStrength.value).toBe(0)
      material.setUniformsFromParams(nebulaParamsFromData({ lighting: { anisotropy: null } }))
      expect(material.uniforms.uPhaseHG.value).toBe(0)
      expect(material.uniforms.uAnisotropy.value).toBe(0)
    } finally { material.dispose() }
  })

  it('keeps merged controls independent of base parameters', () => {
    const base = mergeNebulaParams({ lighting: { anisotropy: -0.2, shadowStrength: 0.6, starPosition: new Vector3(1, 2, 3) }, quality: { lightSteps: 12 } })
    const copy = mergeNebulaParams({ lighting: { ambient: 0.2 } }, base)
    expect(copy.lighting).toMatchObject({ anisotropy: -0.2, shadowStrength: 0.6 })
    expect(copy.quality.lightSteps).toBe(12)
    copy.lighting.shadowStrength = 0
    copy.lighting.starPosition!.set(0, 0, 0)
    copy.quality.lightSteps = 1
    expect(base.lighting.shadowStrength).toBe(0.6)
    expect(base.lighting.starPosition!.toArray()).toEqual([1, 2, 3])
    expect(base.quality.lightSteps).toBe(12)
  })

  it.each([
    [-10, -1, -5, -0.9, 0, 1],
    [10, 8, 100, 0.9, 1, 16],
    [0, 0.5, 4.6, 0, 0.5, 5]
  ])('bounds phase, optical depth scaling, and light samples (%s)', (g, strength, steps, expectedG, expectedStrength, expectedSteps) => {
    const p = mergeNebulaParams({ lighting: { anisotropy: g, shadowStrength: strength }, quality: { lightSteps: steps } })
    expect(p.lighting.anisotropy).toBe(expectedG)
    expect(p.lighting.shadowStrength).toBe(expectedStrength)
    expect(p.quality.lightSteps).toBe(expectedSteps)
  })

  it.each([NaN, Infinity, -Infinity])('replaces non-finite light transport controls (%s)', invalid => {
    const p = mergeNebulaParams({ lighting: { anisotropy: invalid, shadowStrength: invalid }, quality: { lightSteps: invalid } })
    expect(p.lighting.anisotropy).toBeNull()
    expect(p.lighting.shadowStrength).toBe(0)
    expect(p.quality.lightSteps).toBe(6)
  })
})
