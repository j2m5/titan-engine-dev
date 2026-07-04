import { Color, Vector3 } from 'three'
import { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'

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

  it('рисуется поверх 2D-текстуры кольца и атмосферы (политика renderOrder из спеки)', () => {
    expect(makeVolume().renderOrder).toBe(2)
  })

  it('передаёт гейт/рамп/бюджет шагов/радиус планеты в uniforms материала', () => {
    const u = makeVolume().dustMaterial.uniforms
    expect(u.uDustAnglePower.value).toBe(2)
    expect(u.uDustNearFade.value).toBe(20)
    expect(u.uDustMaxSteps.value).toBe(16)
    expect(u.uDustPlanetRadius.value).toBe(12)
  })
})
