import { BrunetonAtmosphereMaterial } from '@/core/renderables/Atmosphere/BrunetonAtmosphereMaterial'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { Actor } from '@/core/models/Actor'

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

describe('BrunetonAtmosphereMaterial: проводка exposure/hdrKnee из data', () => {
  it('без полей — нейтральные дефолты (текущее поведение, кейс Земли)', () => {
    const material = new BrunetonAtmosphereMaterial(stubActor(stubConfig()))
    expect(material.uniforms.exposure.value).toBe(10.0)
    expect(material.uniforms.uHdrKnee.value).toBe(1.0)
  })

  it('поля из data доезжают до юниформов', () => {
    const material = new BrunetonAtmosphereMaterial(stubActor(stubConfig({ exposure: 4, hdrKnee: 0.1 })))
    expect(material.uniforms.exposure.value).toBe(4)
    expect(material.uniforms.uHdrKnee.value).toBe(0.1)
  })

  it('setAtmosphereConfig обновляет обе ручки', () => {
    const material = new BrunetonAtmosphereMaterial(stubActor(stubConfig()))
    material.setAtmosphereConfig(stubConfig({ exposure: 7, hdrKnee: 0.3 }))
    expect(material.uniforms.exposure.value).toBe(7)
    expect(material.uniforms.uHdrKnee.value).toBe(0.3)
  })
})
