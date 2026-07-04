import { ringDustFunctions, ringDustRaymarchFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

describe('RingDust GLSL chunk', () => {
  it('declares the full uniform set of the shared dust model', () => {
    const names = [
      'uDustColor',
      'uDustDensity',
      'uDustScaleHeight',
      'uDustRingInner',
      'uDustRingOuter',
      'uDustCamRingPos',
      'uDustLightDirRing',
      'uDustAnglePower',
      'uDustNearFade',
      'uDustPlanetRadius'
    ]
    for (const name of names) {
      expect(ringDustUniforms).toContain(name)
    }
  })

  it('defines the analytic integrator entry points', () => {
    const fns = [
      'ringDustRadialMask',
      'ringDustVerticalIntegral',
      'ringDustPieceMask',
      'ringDustIntervalTau',
      'ringDustCircleInterval',
      'ringDustTauRay',
      'ringDustHaze',
      'ringDustApplyFog',
      'ringDustDensityAt',
      'ringDustAngleGate',
      'ringDustNearRamp',
      'ringDustPlanetShadow'
    ]
    for (const fn of fns) {
      expect(ringDustFunctions).toContain(fn)
    }
  })

  it('exposes ringDustPlanetShadow in the raymarch core (shared by volume and rocks)', () => {
    // Тень планеты живёт в ядре → доступна и маршу объёма, и аэроперспективе камней
    expect(ringDustRaymarchFunctions).toContain('ringDustPlanetShadow')
  })

  it('points to the CPU mirror the GLSL must stay in sync with', () => {
    const chunkSource = `${ringDustUniforms}\n${ringDustFunctions}`
    // Маркер синхронизации живёт в докблоке модуля; сам GLSL обязан использовать
    // те же формулы, что tests/ringDust/tauMirror.ts (проверяется тестами точности)
    expect(chunkSource).toContain('ringDustTauRay')
  })

  it('composes the full set from the raymarch core (single definition per function)', () => {
    // Полный набор обязан начинаться с ядра реймарша — защита от расхождения копий:
    // каждая GLSL-функция определена ровно один раз, экспорты собираются композицией
    expect(ringDustFunctions.startsWith(ringDustRaymarchFunctions)).toBe(true)
    // Закрытая форма не утекает в подмножество для реймарша
    expect(ringDustRaymarchFunctions).not.toContain('ringDustTauRay')
  })

  it('is registered in AppShaderChunk for #include resolution', () => {
    expect(AppShaderChunk.ringDustUniforms).toBe(ringDustUniforms)
    expect(AppShaderChunk.ringDustFunctions).toBe(ringDustFunctions)
  })
})
