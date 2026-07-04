import { Color, Vector3 } from 'three'
import { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'
import { installRingDustDebug } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustDebug'

const makeVolume = () =>
  new RingDustVolume({
    innerRadius: 70,
    outerRadius: 140,
    dustScaleHeight: 0.5,
    dustDensity: 0.01,
    dustColor: new Color(0x9b968c),
    anglePower: 2,
    nearFade: 20,
    maxSteps: 16
  })

// Минимальный стаб uniforms материала камней
const makeRockUniforms = () => ({ uDustDensity: { value: 0.02 } })

describe('installRingDustDebug', () => {
  afterEach(() => {
    delete (window as any).__titanRingDust
  })

  it('вешает хендл на window и переключает debug-режим объёма', () => {
    const volume = makeVolume()
    installRingDustDebug({ volume, rockUniforms: [makeRockUniforms()] })
    window.__titanRingDust!.setDebugMode(3)
    expect(volume.dustMaterial.uniforms.uDustDebugMode.value).toBe(3)
  })

  it('kill-switch объёма скрывает mesh, не трогая камни', () => {
    const volume = makeVolume()
    const rocks = makeRockUniforms()
    installRingDustDebug({ volume, rockUniforms: [rocks] })
    window.__titanRingDust!.setVolumeEnabled(false)
    expect(volume.visible).toBe(false)
    expect(rocks.uDustDensity.value).toBe(0.02)
  })

  it('kill-switch фога камней зануляет и восстанавливает плотность', () => {
    const volume = makeVolume()
    const rocks = makeRockUniforms()
    installRingDustDebug({ volume, rockUniforms: [rocks] })
    window.__titanRingDust!.setRockFogEnabled(false)
    expect(rocks.uDustDensity.value).toBe(0)
    window.__titanRingDust!.setRockFogEnabled(true)
    expect(rocks.uDustDensity.value).toBe(0.02)
  })
})
