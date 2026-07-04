import { AdditiveBlending, BackSide } from 'three'
import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'

describe('RingDustRaymarchMaterial', () => {
  const make = () => new RingDustRaymarchMaterial()

  it('настроен как аддитивное backface-гало: depthTest ON, depthWrite OFF', () => {
    const m = make()
    expect(m.side).toBe(BackSide)
    expect(m.transparent).toBe(true)
    // depthWrite OFF — не блокирует другие прозрачные; depthTest ON (дефолт) —
    // гало корректно перекрывается планетой (не просвечивает сквозь неё);
    // аддитивный блендинг делает порядок прозрачных неважным
    expect(m.depthWrite).toBe(false)
    expect(m.depthTest).toBe(true)
    expect(m.blending).toBe(AdditiveBlending)
  })

  it('несёт полный uniform-набор модели пыли + марш и диагностику', () => {
    const u = make().uniforms
    for (const name of [
      'uDustColor', 'uDustDensity', 'uDustScaleHeight', 'uDustRingInner', 'uDustRingOuter',
      'uDustCamRingPos', 'uDustLightDirRing', 'uDustAnglePower', 'uDustNearFade',
      'uDustPlanetRadius', 'uDustMaxSteps', 'uDustDebugMode'
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
    // тень планеты пошагово (затемняет цвет, не alpha)
    expect(fs).toContain('ringDustPlanetShadow')
    expect(fs).toContain('litTau')
    // диагностические режимы
    expect(fs).toContain('uDustDebugMode')
  })

  it('НЕ использует замкнутую форму tau в объёме (марш — точка расширения под шум)', () => {
    expect(make().fragmentShader).not.toContain('ringDustTauRay')
  })
})
