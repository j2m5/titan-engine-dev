import { describe, expect, it } from 'vitest'
import { autoCalibrateAmplitude, type CalibrationSample } from '../../scripts/lib/autoCalibrate'

describe('autoCalibrateAmplitude: линейная подгонка амплитуды под target RMS(tan)', () => {
  it('линейная система: попадает в допуск ±10% за ≤2 прогона', () => {
    const calls: number[] = []
    const linear = (amp: number): CalibrationSample => {
      calls.push(amp)
      return { rmsTan: amp * 2e-5, peakMeters: amp * 0.5 } // RMS ~ линеен, пик — произвольная линейная проекция
    }

    const r = autoCalibrateAmplitude(linear, 3000, 0.07, 1e9)

    expect(Math.abs(r.rmsTan - 0.07) / 0.07).toBeLessThanOrEqual(0.1)
    expect(r.iterations).toBeLessThanOrEqual(2)
    expect(r.clamped).toBe(false)
    expect(calls.length).toBe(r.iterations)
    expect(r.peakMeters).toBeCloseTo(r.amplitudeMeters * 0.5, 6) // пик последнего прогона передан честно
  })

  it('слабонелинейная система: добирает третьей итерацией', () => {
    const calls: number[] = []
    // rms = k·amp^0.9 (сублинейно), k подобран так, что rms(3000) ≈ 0.02 —
    // достаточно далеко от target 0.07, что одной линейной поправки не хватает
    const k = 0.02 / Math.pow(3000, 0.9)
    const nonlinear = (amp: number): CalibrationSample => {
      calls.push(amp)
      return { rmsTan: k * Math.pow(amp, 0.9), peakMeters: amp * 0.3 }
    }

    const r = autoCalibrateAmplitude(nonlinear, 3000, 0.07, 1e9)

    expect(calls.length).toBe(3)
    expect(r.iterations).toBe(3)
    expect(Math.abs(r.rmsTan - 0.07) / 0.07).toBeLessThanOrEqual(0.1)
    expect(r.clamped).toBe(false)
    expect(r.peakMeters).toBeCloseTo(r.amplitudeMeters * 0.3, 6)
  })

  it('кламп: цель недостижима под потолком → амплитуда = потолок, clamped=true, rmsTan честный', () => {
    const generate = (amp: number): CalibrationSample => ({ rmsTan: amp * 1e-6, peakMeters: amp * 0.1 })
    const r = autoCalibrateAmplitude(generate, 3000, 0.07, 5000)

    expect(r.clamped).toBe(true)
    expect(r.amplitudeMeters).toBe(5000)
    expect(r.rmsTan).toBeCloseTo(5000 * 1e-6, 12)
    expect(r.peakMeters).toBeCloseTo(5000 * 0.1, 12)
  })

  it('референсная амплитуда уже над потолком: клампится на первом же прогоне', () => {
    const calls: number[] = []
    const linear = (amp: number): CalibrationSample => {
      calls.push(amp)
      return { rmsTan: amp * 2e-5, peakMeters: amp * 0.5 }
    }

    const r = autoCalibrateAmplitude(linear, 3000, 0.07, 1000)

    expect(calls[0]).toBe(1000)
    expect(r.clamped).toBe(true)
    expect(r.amplitudeMeters).toBe(1000)
  })

  it('детерминизм: те же входы — тот же результат', () => {
    const generate = (amp: number): CalibrationSample => ({ rmsTan: amp * 2e-5, peakMeters: amp * 0.5 })

    const a = autoCalibrateAmplitude(generate, 3000, 0.07, 1e9)
    const b = autoCalibrateAmplitude(generate, 3000, 0.07, 1e9)

    expect(b).toEqual(a)
  })

  it('пик поля превышает бюджет при амплитуде в рамках: peakMeters передаётся честно, clamped (по амплитуде) его не подменяет', () => {
    // RMS сразу в допуске при референсной амплитуде (3000, далеко в рамках
    // бюджета 5000) — итерация вообще не трогает амплитуду-параметр. Пик поля
    // (подложка + band-овершут вне контроля этой функции) при этом — 50000,
    // далеко за бюджетом. Находка 1: старый clamped (по амплитуде) не ловит
    // такой перерасход — честный peakMeters в результате даёт вызывающему
    // коду (batch-скрипт) всё нужное для отдельного рескейла подложки+bump.
    const generate = (): CalibrationSample => ({ rmsTan: 0.07, peakMeters: 50000 })

    const r = autoCalibrateAmplitude(generate, 3000, 0.07, 5000)

    expect(r.iterations).toBe(1)
    expect(r.amplitudeMeters).toBe(3000)
    expect(r.clamped).toBe(false)
    expect(r.peakMeters).toBe(50000)
  })
})
