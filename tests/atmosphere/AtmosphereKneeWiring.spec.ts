import { Object3D, PerspectiveCamera, Texture, WebGLRenderer, WebGLRenderTarget } from 'three'
import { AtmosphereEffect } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import { buildSlotGlsl, slotUniformName } from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'
import { AtmosphereRegistry, AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { SpaceScale } from '@/core/constants'

function config(extra: Partial<AtmosphereConfig> = {}): AtmosphereConfig {
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

function entryWith(extra: Partial<AtmosphereConfig> = {}): AtmosphereEntry {
  const object = new Object3D()
  object.position.set(0, 0, -50000 * SpaceScale)
  object.updateMatrixWorld(true)
  return {
    actorId: 1,
    name: 'StubPlanet',
    object,
    config: config(extra),
    lut: { transmittance: new Texture(), scattering: new Texture(), irradiance: new Texture() }
  }
}

function cameraAtOrigin(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e12)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return camera
}

describe('AtmosphereEffect: проводка exposure/hdrKnee из data', () => {
  it('без полей — нейтральные дефолты (кейс Земли)', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entryWith())
    const effect = new AtmosphereEffect(cameraAtOrigin(), registry)
    effect.update({} as WebGLRenderer, {} as WebGLRenderTarget)
    expect(effect.uniforms.get(slotUniformName(0, 'exposure'))!.value).toBe(10)
    expect(effect.uniforms.get(slotUniformName(0, 'hdrKnee'))!.value).toBe(1)
  })

  it('hdrKnee из конфига доезжает в юниформ слота эффекта', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entryWith({ exposure: 4, hdrKnee: 0.1 }))
    const effect = new AtmosphereEffect(cameraAtOrigin(), registry)
    effect.update({} as WebGLRenderer, {} as WebGLRenderTarget)
    expect(effect.uniforms.get(slotUniformName(0, 'exposure'))!.value).toBe(4)
    expect(effect.uniforms.get(slotUniformName(0, 'hdrKnee'))!.value).toBe(0.1)
  })

  it('колено применяется к in-scatter ДО потолка 64 и после exposure — формула в GLSL слота', () => {
    const slot = buildSlotGlsl(0)
    const exposure = slot.indexOf('vec3 scatter = radiance * uSlot0_exposure;')
    const knee = slot.indexOf('excess * uSlot0_hdrKnee')
    const cap = slot.indexOf('min(scatter, vec3(64.0))')
    expect(exposure).toBeGreaterThan(-1)
    expect(knee).toBeGreaterThan(exposure)
    expect(cap).toBeGreaterThan(knee)
  })
})
