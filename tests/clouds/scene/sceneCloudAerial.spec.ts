import { describe, it, expect } from 'vitest'
import { CloudsEffect } from '@takram/three-clouds'
import { PerspectiveCamera } from 'three'
import { atmosphereShader } from '@/core/renderables/Atmosphere/atmosphere'
import { buildMainCloudAerialKernel, adaptSceneCloudAerial } from '@/core/clouds/takram/sceneCloudAerial'

describe('main scene aerial compatibility', () => {
  it('derives the main raw kernel and its Mie dependencies without the pinned night/horizon hacks', () => {
    const kernel = buildMainCloudAerialKernel()
    expect(kernel).toContain('sceneCloudGetSkyRadianceToPoint(')
    expect(kernel).toContain('sceneCloudGetCombinedScattering(')
    expect(kernel).toContain('sceneCloudGetExtrapolatedSingleMieScattering(')
    expect(kernel).toContain('if (!(scattering.r > 0.0))')
    expect(kernel).not.toContain('smoothstep(Number(0.0), Number(0.01), mu_s)')
    expect(kernel).not.toMatch(/\b(?:IN|OUT)\(/)
  })
  it('guards unique main-source extraction instead of silently selecting an overload', () => {
    expect(() =>
      buildMainCloudAerialKernel(
        atmosphereShader.replace('RadianceSpectrum GetSkyRadianceToPoint(', 'RadianceSpectrum Missing(')
      )
    ).toThrow(/GetSkyRadianceToPoint/)
    const cut = atmosphereShader.indexOf('#define RADIANCE_API_ENABLED')
    expect(() => buildMainCloudAerialKernel(atmosphereShader.slice(0, cut).repeat(2))).toThrow(/expected one/)
  })
  it('replaces exactly the pinned current aerial function before temporal processing', () => {
    const clouds = new CloudsEffect(new PerspectiveCamera())
    try {
      const source = clouds.cloudsPass.currentMaterial.fragmentShader
      const adapted = adaptSceneCloudAerial(source)
      expect(adapted).toContain(
        'sceneCloudGetSkyRadianceToPoint(ATMOSPHERE, transmittance_texture, scattering_texture, scattering_texture,'
      )
      expect(adapted).toContain('applyAerialPerspective(cameraPosition, frontPosition, shadowLength, color);')
      expect(() =>
        adaptSceneCloudAerial(source.replace('void applyAerialPerspective(', 'void missingAerial('))
      ).toThrow()
      expect(() => adaptSceneCloudAerial(source + source)).toThrow()
    } finally {
      clouds.dispose()
    }
  })
})
