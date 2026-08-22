import { Object3D, PerspectiveCamera, Texture, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { EffectAttribute } from 'postprocessing'
import { AtmosphereEffect } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import { ATMOSPHERE_SLOTS, slotUniformName } from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'
import { AtmosphereRegistry, AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { SpaceScale } from '@/core/constants'

function config(bottom: number, top: number): AtmosphereConfig {
  return {
    solarIrradiance: [1.474, 1.8504, 1.91198],
    sunAngularRadius: 0.004,
    bottomRadius: bottom,
    topRadius: top,
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
    exposure: 1.4,
    hdrKnee: 0.5
  }
}

function entry(actorId: number, positionKm: Vector3, bottom: number, top: number): AtmosphereEntry {
  const object = new Object3D()
  object.position.copy(positionKm).multiplyScalar(SpaceScale)
  object.updateMatrixWorld(true)
  return {
    actorId,
    name: `A${actorId}`,
    object,
    config: config(bottom, top),
    lut: { transmittance: new Texture(), scattering: new Texture(), irradiance: new Texture() }
  }
}

function cameraAtOrigin(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e12)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return camera
}

const renderer = {} as WebGLRenderer
const buffer = {} as WebGLRenderTarget

describe('AtmosphereEffect', () => {
  it('атрибут DEPTH и K троек сэмплеров в юниформах', () => {
    const effect = new AtmosphereEffect(cameraAtOrigin(), new AtmosphereRegistry())
    expect(effect.getAttributes() & EffectAttribute.DEPTH).toBeTruthy()
    for (let i = 0; i < ATMOSPHERE_SLOTS; i++) {
      expect(effect.uniforms.has(slotUniformName(i, 'transmittance'))).toBe(true)
      expect(effect.uniforms.has(slotUniformName(i, 'scattering'))).toBe(true)
      expect(effect.uniforms.has(slotUniformName(i, 'irradiance'))).toBe(true)
    }
  })

  it('пустой реестр → uCount = 0', () => {
    const effect = new AtmosphereEffect(cameraAtOrigin(), new AtmosphereRegistry())
    effect.update(renderer, buffer)
    expect(effect.uniforms.get('uCount')!.value).toBe(0)
    expect(effect.slotCount).toBe(0)
  })

  it('одна атмосфера: центр в км относительно камеры, sunDir к нулю, LUT в слоте 0', () => {
    const registry = new AtmosphereRegistry()
    const e = entry(1, new Vector3(0, 0, -50000), 6360, 6420)
    registry.register(e)
    const effect = new AtmosphereEffect(cameraAtOrigin(), registry)
    effect.update(renderer, buffer)

    expect(effect.uniforms.get('uCount')!.value).toBe(1)
    const center = effect.uniforms.get(slotUniformName(0, 'center'))!.value as Vector3
    expect(center.z).toBeCloseTo(-50000, 3)
    const sunDir = effect.uniforms.get(slotUniformName(0, 'sunDir'))!.value as Vector3
    expect(sunDir.z).toBeCloseTo(1, 9) // от центра (0,0,−50000) к нулю
    expect(effect.uniforms.get(slotUniformName(0, 'transmittance'))!.value).toBe(e.lut.transmittance)
    expect(effect.uniforms.get(slotUniformName(0, 'top_radius'))!.value).toBe(6420)
    expect(effect.uniforms.get(slotUniformName(0, 'exposure'))!.value).toBe(1.4)
    expect(effect.uniforms.get(slotUniformName(0, 'hdrKnee'))!.value).toBe(0.5)
  })

  // Аналитический диск снят: импостор звезды уже проходит через T эффекта
  it('юниформа размера диска солнца нет ни в одном слоте', () => {
    const effect = new AtmosphereEffect(cameraAtOrigin(), new AtmosphereRegistry())
    for (let i = 0; i < ATMOSPHERE_SLOTS; i++) {
      expect(effect.uniforms.has(slotUniformName(i, 'sunSize'))).toBe(false)
    }
  })

  it('камера вне нуля: sunDir считается от МИРОВОГО центра, center — относительно камеры', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry(1, new Vector3(0, 0, -50000), 6360, 6420))
    const camera = new PerspectiveCamera(50, 1, 1e-6, 1e12)
    camera.position.set(10000 * SpaceScale, 0, 0)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    const effect = new AtmosphereEffect(camera, registry)
    effect.update(renderer, buffer)

    // Звезда в мировом нуле: от центра (0,0,−50000) на неё смотрит (0,0,1)
    const sunDir = effect.uniforms.get(slotUniformName(0, 'sunDir'))!.value as Vector3
    expect(sunDir.x).toBeCloseTo(0, 9)
    expect(sunDir.z).toBeCloseTo(1, 9)
    // Центр оболочки остаётся в осях камеры
    const center = effect.uniforms.get(slotUniformName(0, 'center'))!.value as Vector3
    expect(center.x).toBeCloseTo(-10000, 3)
    expect(center.z).toBeCloseTo(-50000, 3)
  })

  it('две атмосферы: дальняя в слоте 0, ближняя в слоте 1', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry(1, new Vector3(0, 0, -10000), 2575, 2875))
    registry.register(entry(2, new Vector3(0, 0, -90000), 58232, 58632))
    const effect = new AtmosphereEffect(cameraAtOrigin(), registry)
    effect.update(renderer, buffer)
    expect(effect.uniforms.get('uCount')!.value).toBe(2)
    expect(effect.uniforms.get(slotUniformName(0, 'top_radius'))!.value).toBe(58632)
    expect(effect.uniforms.get(slotUniformName(1, 'top_radius'))!.value).toBe(2875)
  })

  it('сверх K — предупреждение один раз, uCount = K', () => {
    const registry = new AtmosphereRegistry()
    for (let i = 0; i < ATMOSPHERE_SLOTS + 1; i++) {
      registry.register(entry(i, new Vector3(0, 0, -10000 * (i + 1)), 6000, 6100))
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const effect = new AtmosphereEffect(cameraAtOrigin(), registry)
    effect.update(renderer, buffer)
    effect.update(renderer, buffer)
    expect(effect.uniforms.get('uCount')!.value).toBe(ATMOSPHERE_SLOTS)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('пустые слоты не держат LUT ушедшего сценария', () => {
    const registry = new AtmosphereRegistry()
    registry.register(entry(1, new Vector3(0, 0, -10000), 2575, 2875))
    registry.register(entry(2, new Vector3(0, 0, -90000), 58232, 58632))
    const effect = new AtmosphereEffect(cameraAtOrigin(), registry)
    effect.update(renderer, buffer)
    expect(effect.uniforms.get(slotUniformName(1, 'transmittance'))!.value).not.toBeNull()

    registry.unregister(1)
    effect.update(renderer, buffer)
    expect(effect.uniforms.get('uCount')!.value).toBe(1)
    expect(effect.uniforms.get(slotUniformName(1, 'transmittance'))!.value).toBeNull()
    expect(effect.uniforms.get(slotUniformName(1, 'scattering'))!.value).toBeNull()
    expect(effect.uniforms.get(slotUniformName(1, 'irradiance'))!.value).toBeNull()
  })

  it('матрицы камеры и лог-фактор обновляются из камеры', () => {
    const camera = cameraAtOrigin()
    const effect = new AtmosphereEffect(camera, new AtmosphereRegistry())
    effect.update(renderer, buffer)
    expect(effect.uniforms.get('uLogFarFactor')!.value).toBeCloseTo(Math.log2(camera.far + 1), 9)
    expect(effect.uniforms.get('uInverseSpaceScale')!.value).toBeCloseTo(1 / SpaceScale, 6)
    expect(effect.uniforms.get('uProjectionInverse')!.value).toBe(camera.projectionMatrixInverse)
    expect(effect.uniforms.get('uCameraWorldMatrix')!.value).toBe(camera.matrixWorld)
  })

  it('dispose эффекта не освобождает LUT — они принадлежат узлу', () => {
    const registry = new AtmosphereRegistry()
    const e = entry(1, new Vector3(0, 0, -50000), 6360, 6420)
    const spy = vi.spyOn(e.lut.transmittance, 'dispose')
    registry.register(e)
    const effect = new AtmosphereEffect(cameraAtOrigin(), registry)
    effect.update(renderer, buffer)
    effect.dispose()
    expect(spy).not.toHaveBeenCalled()
  })

  it('debugView из опций уезжает в uDebugView', () => {
    const effect = new AtmosphereEffect(cameraAtOrigin(), new AtmosphereRegistry(), { debugView: 4 })
    expect(effect.uniforms.get('uDebugView')!.value).toBe(4)
  })
})
