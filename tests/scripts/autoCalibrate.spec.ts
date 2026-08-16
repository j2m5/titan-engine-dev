import { describe, expect, it } from 'vitest'
import { autoCalibrateAmplitude } from '../../scripts/lib/autoCalibrate'

describe('autoCalibrateAmplitude: линейная подгонка амплитуды под target RMS(tan)', () => {
  it('линейная система: попадает в допуск ±10% за ≤2 прогона', () => {
    const calls: number[] = []
    const linear = (amp: number): number => {
      calls.push(amp)
      return amp * 2e-5
    } // RMS ~ линеен

    const r = autoCalibrateAmplitude(linear, 3000, 0.07, 1e9)

    expect(Math.abs(r.rmsTan - 0.07) / 0.07).toBeLessThanOrEqual(0.1)
    expect(r.iterations).toBeLessThanOrEqual(2)
    expect(r.clamped).toBe(false)
    expect(calls.length).toBe(r.iterations)
  })

  it('слабонелинейная система: добирает третьей итерацией', () => {
    const calls: number[] = []
    // rms = k·amp^0.9 (сублинейно), k подобран так, что rms(3000) ≈ 0.02 —
    // достаточно далеко от target 0.07, что одной линейной поправки не хватает
    const k = 0.02 / Math.pow(3000, 0.9)
    const nonlinear = (amp: number): number => {
      calls.push(amp)
      return k * Math.pow(amp, 0.9)
    }

    const r = autoCalibrateAmplitude(nonlinear, 3000, 0.07, 1e9)

    expect(calls.length).toBe(3)
    expect(r.iterations).toBe(3)
    expect(Math.abs(r.rmsTan - 0.07) / 0.07).toBeLessThanOrEqual(0.1)
    expect(r.clamped).toBe(false)
  })

  it('кламп: цель недостижима под потолком → амплитуда = потолок, clamped=true, rmsTan честный', () => {
    const r = autoCalibrateAmplitude((amp) => amp * 1e-6, 3000, 0.07, 5000)

    expect(r.clamped).toBe(true)
    expect(r.amplitudeMeters).toBe(5000)
    expect(r.rmsTan).toBeCloseTo(5000 * 1e-6, 12)
  })

  it('референсная амплитуда уже над потолком: клампится на первом же прогоне', () => {
    const calls: number[] = []
    const linear = (amp: number): number => {
      calls.push(amp)
      return amp * 2e-5
    }

    const r = autoCalibrateAmplitude(linear, 3000, 0.07, 1000)

    expect(calls[0]).toBe(1000)
    expect(r.clamped).toBe(true)
    expect(r.amplitudeMeters).toBe(1000)
  })

  it('детерминизм: те же входы — тот же результат', () => {
    const generate = (amp: number): number => amp * 2e-5

    const a = autoCalibrateAmplitude(generate, 3000, 0.07, 1e9)
    const b = autoCalibrateAmplitude(generate, 3000, 0.07, 1e9)

    expect(b).toEqual(a)
  })
})
