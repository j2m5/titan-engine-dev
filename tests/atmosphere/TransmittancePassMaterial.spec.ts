import {
  AtmospherePass,
  BrunetonAtmosphereMaterial
} from '@/core/renderables/Atmosphere/BrunetonAtmosphereMaterial'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { Actor } from '@/core/models/Actor'
import { CustomBlending, OneFactor, SrcColorFactor, ZeroFactor } from 'three'

// Заглушки в том же виде, что в tests/atmosphere/AtmosphereKneeWiring.spec.ts
function stubConfig(extra: Partial<AtmosphereConfig> = {}): AtmosphereConfig {
  return {
    solarIrradiance: [1.474, 1.8504, 1.91198],
    sunAngularRadius: 0.004,
    bottomRadius: 6360,
    topRadius: 6420,
    rayleighDensity: [EMPTY_LAYER, expLayer(8)],
    rayleighScattering: [0.005802, 0.013558, 0.0331],
    mieDensity: [EMPTY_LAYER, expLayer(1.2)],
    mieScattering: [0.003996, 0.003996, 0.003996],
    mieExtinction: [0.00444, 0.00444, 0.00444],
    miePhaseFunctionG: 0.8,
    absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
    absorptionExtinction: [0, 0, 0],
    groundAlbedo: [0.1, 0.1, 0.1],
    muSMin: -0.2,
    ...extra
  }
}

function stubActor(config: AtmosphereConfig): Actor {
  return {
    renderingObject: { getAttribute: () => config },
    getAttribute: () => 'StubPlanet'
  } as unknown as Actor
}

describe('BrunetonAtmosphereMaterial: два прохода композиции', () => {
  it('проход пропускания множит кадр покомпонентно', () => {
    const material = new BrunetonAtmosphereMaterial(stubActor(stubConfig()), AtmospherePass.Transmittance)

    expect(material.defines.ATMOSPHERE_PASS_TRANSMITTANCE).toBe('1')
    expect(material.blending).toBe(CustomBlending)
    expect(material.blendSrc).toBe(ZeroFactor)
    expect(material.blendDst).toBe(SrcColorFactor)
  })

  it('проход in-scatter складывается с кадром', () => {
    const material = new BrunetonAtmosphereMaterial(stubActor(stubConfig()), AtmospherePass.InScatter)

    expect(material.defines.ATMOSPHERE_PASS_TRANSMITTANCE).toBeUndefined()
    expect(material.blending).toBe(CustomBlending)
    expect(material.blendSrc).toBe(OneFactor)
    expect(material.blendDst).toBe(OneFactor)
  })

  it('оба прохода не трогают альфу целевого буфера', () => {
    for (const pass of [AtmospherePass.Transmittance, AtmospherePass.InScatter]) {
      const material = new BrunetonAtmosphereMaterial(stubActor(stubConfig()), pass)

      expect(material.blendSrcAlpha).toBe(ZeroFactor)
      expect(material.blendDstAlpha).toBe(OneFactor)
    }
  })

  it('по умолчанию материал — проход in-scatter (старые вызовы не ломаются)', () => {
    const material = new BrunetonAtmosphereMaterial(stubActor(stubConfig()))

    expect(material.defines.ATMOSPHERE_PASS_TRANSMITTANCE).toBeUndefined()
  })

  it('связанные проходы делят один объект uniforms — иначе кромка разъедется', () => {
    const scatter = new BrunetonAtmosphereMaterial(stubActor(stubConfig()), AtmospherePass.InScatter)
    const transmittance = new BrunetonAtmosphereMaterial(stubActor(stubConfig()), AtmospherePass.Transmittance)

    transmittance.shareUniformsWith(scatter)

    expect(transmittance.uniforms).toBe(scatter.uniforms)

    scatter.uniforms.exposure.value = 42
    expect(transmittance.uniforms.exposure.value).toBe(42)
  })

  it('глубина пишется вручную, поэтому depthWrite выключен у обоих', () => {
    for (const pass of [AtmospherePass.Transmittance, AtmospherePass.InScatter]) {
      const material = new BrunetonAtmosphereMaterial(stubActor(stubConfig()), pass)

      expect(material.depthWrite).toBe(false)
      expect(material.transparent).toBe(true)
    }
  })
})
