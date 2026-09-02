import { Color, PerspectiveCamera, Texture, Vector2, Vector3 } from 'three'
import { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'

const makeVolume = () =>
  new RingDustVolume({
    innerRadius: 70,
    outerRadius: 140,
    dustScaleHeight: 0.5,
    dustDensity: 0.01,
    dustColor: new Color(0x9b968c),
    anglePower: 2,
    nearFade: 20,
    maxSteps: 16,
    planetRadius: 12
  })

describe('RingDustVolume', () => {
  it('прокси — охватывающая сфера радиуса outerRadius·padding (покрытие из любого ракурса)', () => {
    const volume = makeVolume()
    volume.geometry.computeBoundingBox()
    const box = volume.geometry.boundingBox!
    // Сфера радиуса 140 * 1.05 = 147 по всем осям — охватывает кольцо целиком
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(box.max[axis]).toBeCloseTo(147, 0)
      expect(box.min[axis]).toBeCloseTo(-147, 0)
    }
  })

  it('feeds config into material uniforms', () => {
    const volume = makeVolume()
    const u = volume.dustMaterial.uniforms
    expect(u.uDustScaleHeight.value).toBe(0.5)
    expect(u.uDustDensity.value).toBe(0.01)
    expect(u.uDustRingInner.value).toBe(70)
    expect(u.uDustRingOuter.value).toBe(140)
  })

  it('updatePerFrame copies camera and light into uniforms', () => {
    const volume = makeVolume()
    volume.updatePerFrame(new Vector3(1, 2, 3), new Vector3(0, 0, 1))
    expect(volume.dustMaterial.uniforms.uDustCamRingPos.value.x).toBe(1)
    expect(volume.dustMaterial.uniforms.uDustLightDirRing.value.z).toBe(1)
  })

  it('is named and not frustum culled', () => {
    const volume = makeVolume()
    expect(volume.name).toBe('RingDustVolume')
    expect(volume.frustumCulled).toBe(false)
  })

  it('передаёт гейт/рамп/бюджет шагов/радиус планеты в uniforms материала', () => {
    const u = makeVolume().dustMaterial.uniforms
    expect(u.uDustAnglePower.value).toBe(2)
    expect(u.uDustNearFade.value).toBe(20)
    expect(u.uDustMaxSteps.value).toBe(16)
    expect(u.uDustPlanetRadius.value).toBe(12)
  })

  it('лежит на слое пыли, невидимом для основного прохода камеры', () => {
    const volume = makeVolume()
    // Основной RenderPass рисует слой 0; гало рисует свой пасс, включая слой
    // пыли на камере только на время своего рендера
    expect(volume.layers.mask).toBe(1 << DEPTH_VOLUME_LAYER)
    expect(new PerspectiveCamera().layers.test(volume.layers)).toBe(false)
  })

  it('регистрируется в реестре при создании и снимается в dispose (идемпотентно)', () => {
    const registry = new DepthVolumeRegistry()
    const volume = new RingDustVolume({
      innerRadius: 70,
      outerRadius: 140,
      dustScaleHeight: 0.5,
      dustDensity: 0.01,
      dustColor: new Color(0x9b968c),
      anglePower: 2,
      nearFade: 20,
      maxSteps: 16,
      planetRadius: 12,
      registry
    })
    expect(registry.volumes()).toEqual([volume])

    volume.dispose()
    volume.dispose()
    expect(registry.volumes()).toEqual([])
  })

  it('bindSceneDepth включает обрезку и передаёт копию глубины, unbind выключает', () => {
    const volume = makeVolume()
    const u = volume.dustMaterial.uniforms
    expect(u.uSceneDepthEnabled.value).toBe(0)

    const texture = new Texture()
    volume.bindSceneDepth(texture, new Vector2(800, 600), 7)
    expect(u.uSceneDepth.value).toBe(texture)
    expect(u.uResolution.value.x).toBe(800)
    expect(u.uLogFarFactor.value).toBe(7)
    expect(u.uSceneDepthEnabled.value).toBe(1)

    volume.unbindSceneDepth()
    expect(u.uSceneDepthEnabled.value).toBe(0)
  })

  it('без реестра живёт автономно: dispose не падает', () => {
    expect(() => makeVolume().dispose()).not.toThrow()
  })
})
