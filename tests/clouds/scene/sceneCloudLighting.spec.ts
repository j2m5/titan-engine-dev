import { describe, it, expect } from 'vitest'
import { cloudLightScale } from '@/core/clouds/takram/sceneCloudLighting'
import { installSceneCloudPatches } from '@/core/clouds/takram/sceneCloudLighting'
import { CloudsEffect } from '@takram/three-clouds'
import { PerspectiveCamera } from 'three'

describe('main scene cloud light units', () => {
  it('installs the scene-reference branch atomically without adding LUT samplers or a second unit conversion', () => {
    const clouds = new CloudsEffect(new PerspectiveCamera())
    const material = clouds.cloudsPass.currentMaterial
    const original = material.fragmentShader
    const samplers = (shader: string) => [...shader.matchAll(/uniform\s+(?:highp\s+)?sampler\w+\s+/g)].length
    try {
      material.fragmentShader = original.replace(
        'radiance += skyIrradiance * RECIPROCAL_PI4 * skyGradient * skyLightScale;',
        'radiance += vec3(0.0);'
      )
      const invalid = material.fragmentShader
      expect(() => installSceneCloudPatches(clouds, true)).toThrow()
      expect(material.fragmentShader).toBe(invalid)
      material.fragmentShader = original
      const binding = installSceneCloudPatches(clouds, true)
      expect(samplers(material.fragmentShader)).toBe(samplers(original))
      expect(material.fragmentShader).not.toContain(
        'radianceIntegral *= sceneCloudTargetWhite / sceneCloudReferenceWhite;'
      )
      expect(material.fragmentShader).toContain('sceneCloudReferenceLight')
      binding.dispose()
      expect(material.fragmentShader).toBe(original)
    } finally {
      clouds.dispose()
    }
  })
  it('patches pinned anchors atomically, refuses duplicate installation and restores idempotently', () => {
    const clouds = new CloudsEffect(new PerspectiveCamera())
    const cloud = clouds.cloudsPass.currentMaterial,
      shadow = clouds.shadowPass.currentMaterial
    const original = cloud.fragmentShader,
      shadowOriginal = shadow.fragmentShader
    try {
      for (const invalid of [
        original.replace('float getRayDistanceToScene(', 'float missingDepth('),
        original + original
      ]) {
        cloud.fragmentShader = invalid
        expect(() => installSceneCloudPatches(clouds)).toThrow()
        expect(cloud.fragmentShader).toBe(invalid)
        expect(shadow.fragmentShader).toBe(shadowOriginal)
      }
      cloud.fragmentShader = original
      const binding = installSceneCloudPatches(clouds)
      const patched = cloud.fragmentShader
      expect(patched).toContain('depth * sceneCloudLogFarFactor')
      expect(patched).toContain('vUv * targetUvScale + temporalJitter')
      expect(patched).toContain('radianceIntegral *= sceneCloudTargetWhite / sceneCloudReferenceWhite;')
      expect(() => installSceneCloudPatches(clouds)).toThrow(/installed/)
      expect(cloud.fragmentShader).toBe(patched)
      binding.dispose()
      binding.dispose()
      expect(cloud.fragmentShader).toBe(original)
      expect(shadow.fragmentShader).toBe(shadowOriginal)
    } finally {
      clouds.dispose()
    }
  })
  it('converts radiometric Lambert white into independently specified main scene white', () => {
    const scale = cloudLightScale([2, 4, 8], [10, 10, 10], [0.5, 0.5, 0.5], [0.99, 0.5, 0.25])
    expect(scale[0]).toBeCloseTo(0.099 * Math.PI, 12)
    expect(scale[1]).toBeCloseTo(0.025 * Math.PI, 12)
    expect(scale[2]).toBeCloseTo(0.00625 * Math.PI, 12)
  })
  it('permits zero target and clamps small finite transmittance', () => {
    expect(cloudLightScale([2, 4, 8], [10, 10, 10], [0, 0.0001, 1], [0, 0.5, 0.25])).toEqual([
      0,
      12.5 * Math.PI,
      0.003125 * Math.PI
    ])
  })
  it('rejects invalid light inputs instead of publishing NaN or infinite radiance', () => {
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(() => cloudLightScale([invalid, 4, 8], [10, 10, 10], [0.5, 0.5, 0.5], [1, 1, 1])).toThrow()
      expect(() => cloudLightScale([2, 4, 8], [invalid, 10, 10], [0.5, 0.5, 0.5], [1, 1, 1])).toThrow()
    }
    for (const invalid of [-1, NaN, Infinity]) {
      expect(() => cloudLightScale([2, 4, 8], [10, 10, 10], [invalid, 0.5, 0.5], [1, 1, 1])).toThrow()
      expect(() => cloudLightScale([2, 4, 8], [10, 10, 10], [0.5, 0.5, 0.5], [invalid, 1, 1])).toThrow()
    }
  })
})
