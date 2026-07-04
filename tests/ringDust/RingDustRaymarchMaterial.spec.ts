import { BackSide } from 'three'
import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'

describe('RingDustRaymarchMaterial', () => {
  const make = () => new RingDustRaymarchMaterial()

  it('настроен как полупрозрачный backface-объём без записи глубины', () => {
    const m = make()
    expect(m.side).toBe(BackSide)
    expect(m.transparent).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.depthTest).toBe(true)
  })

  it('несёт полный uniform-набор модели пыли + марш и диагностику', () => {
    const u = make().uniforms
    for (const name of [
      'uDustColor', 'uDustDensity', 'uDustScaleHeight', 'uDustRingInner', 'uDustRingOuter',
      'uDustCamRingPos', 'uDustLightDirRing', 'uDustAnglePower', 'uDustNearFade',
      'uDustMaxSteps', 'uDustDebugMode'
    ]) {
      expect(u[name], name).toBeDefined()
    }
    expect(u.uDustMaxSteps.value).toBe(16)
    expect(u.uDustDebugMode.value).toBe(0)
  })

  it('фрагментный шейдер маршит по интервалам с джиттером, ранним выходом и гейтом', () => {
    const fs = make().fragmentShader
    // марш по аналитическим интервалам, а не по всему прокси
    expect(fs).toContain('ringDustCircleInterval')
    expect(fs).toContain('ringDustDensityAt')
    // IGN-джиттер против бандинга
    expect(fs).toContain('52.9829189')
    // early-exit по насыщению
    expect(fs).toContain('0.995')
    // гейт по углу и рамп
    expect(fs).toContain('ringDustAngleGate')
    expect(fs).toContain('ringDustNearRamp')
    // диагностические режимы
    expect(fs).toContain('uDustDebugMode')
  })

  it('НЕ использует замкнутую форму tau в объёме (марш — точка расширения под шум)', () => {
    expect(make().fragmentShader).not.toContain('ringDustTauRay')
  })
})
