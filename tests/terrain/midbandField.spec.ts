import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { snoiseGrad3, type NoiseGrad3 } from '@/core/terrain/simplexNoise3'
import {
  MIDBAND_ASPECT,
  MIDBAND_ENVELOPE_MAX,
  MIDBAND_GRAD_BOUND,
  MIDBAND_NYQUIST_HI,
  MIDBAND_NYQUIST_LO,
  MIDBAND_OCTAVES,
  MIDBAND_P99,
  MIDBAND_RIDGE_MEAN,
  MidbandField,
  midbandOctaveWeight,
  type MidbandEnvelope,
  type MidbandSample
} from '@/core/terrain/midbandField'

const R_M = 1737400
const LAMBDA0 = 1600
const flatEnv: MidbandEnvelope = { slopeTan: 0, curvature: 0, downE: 1, downN: 0 }
const wallEnv: MidbandEnvelope = { slopeTan: 0.3, curvature: 0.8, downE: 0.6, downN: 0.8 }

function dirs(n: number): Vector3[] {
  return Array.from({ length: n }, (_, k) => {
    const t = (k + 0.5) / n
    const phi = k * 2.399963 // золотая спираль — без Math.random
    const y = 1 - 2 * t
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    return new Vector3(r * Math.cos(phi), y, r * Math.sin(phi))
  })
}

describe('MidbandField: амплитуды, огибающая, бонды', () => {
  const field = new MidbandField(MIDBAND_DEFAULTS, LAMBDA0, R_M)
  const out: MidbandSample = { heightMeters: 0, tiltE: 0, tiltN: 0, octaveWeightSum: 0 }

  it('3 октавы, λ_i = λ₀/2^i, A_i = 0.03·λ_i', () => {
    expect(MIDBAND_OCTAVES).toBe(3)
    expect(field.wavelengthsMeters).toEqual([1600, 800, 400])
    expect(field.amplitudesMeters.map((a) => +a.toFixed(6))).toEqual([48, 24, 12])
    expect(MIDBAND_ASPECT).toBe(0.03)
  })

  it('огибающая: равнина = flat, склон полной силы = flat + 1, кромка добавляет ridge·κ, кламп 2', () => {
    expect(field.envelope(flatEnv)).toBeCloseTo(0.15, 9)
    expect(field.envelope({ ...flatEnv, slopeTan: 0.15 })).toBeCloseTo(1.15, 9)
    expect(field.envelope({ ...flatEnv, slopeTan: 0.15, curvature: 0.5 })).toBeCloseTo(1.65, 9)
    expect(field.envelope({ ...flatEnv, slopeTan: 9, curvature: 9 })).toBe(MIDBAND_ENVELOPE_MAX)
    expect(field.envelope({ ...flatEnv, curvature: -1 })).toBeCloseTo(0.15, 9) // вогнутость не усиливает
  })

  it('strength 0 — высота и наклон ровно 0', () => {
    const off = new MidbandField({ ...MIDBAND_DEFAULTS, midbandStrength: 0 }, LAMBDA0, R_M)
    for (const d of dirs(50)) {
      const s = off.sample(d.x, d.y, d.z, wallEnv, out)
      expect(s.heightMeters).toBe(0)
      expect(s.tiltE).toBe(0)
      expect(s.tiltN).toBe(0)
    }
    expect(off.maxAmplitudeMeters).toBe(0)
    expect(off.slopeBound).toBe(0)
  })

  it('детерминизм и масштаб: |mid| ≤ maxAmplitude, суммарный уклон стены — порядка 0.1, не 1.5', () => {
    let maxAbs = 0
    let maxTilt = 0
    for (const d of dirs(4000)) {
      const a = field.sample(d.x, d.y, d.z, wallEnv, out).heightMeters
      const t = Math.hypot(out.tiltE, out.tiltN)
      expect(field.sample(d.x, d.y, d.z, wallEnv, out).heightMeters).toBe(a)
      maxAbs = Math.max(maxAbs, Math.abs(a))
      maxTilt = Math.max(maxTilt, t)
    }
    expect(maxAbs).toBeLessThanOrEqual(field.maxAmplitudeMeters)
    expect(maxTilt).toBeLessThanOrEqual(field.slopeBound)
    expect(maxTilt).toBeLessThan(1.0) // этап 5 давал ~1.5 суммарного уклона; типичный наклон полосы ≈ 0.1, редкие пики выше
    expect(maxAbs).toBeGreaterThan(20) // полоса не вырождена
  })

  it('наклон = конечная разность высоты вдоль дуги (E и N), допуск 2e-3 tan', () => {
    const hArc = 0.05 // метров дуги
    const up = new Vector3(0, 1, 0)
    let worst = 0
    for (const d of dirs(300)) {
      const e = new Vector3().crossVectors(up, d).normalize()
      const n = new Vector3().crossVectors(d, e)
      const s = field.sample(d.x, d.y, d.z, wallEnv, out)
      const tE = s.tiltE
      const tN = s.tiltN
      const dE1 = d.clone().addScaledVector(e, hArc / R_M).normalize()
      const dE0 = d.clone().addScaledVector(e, -hArc / R_M).normalize()
      const fdE = (field.sample(dE1.x, dE1.y, dE1.z, wallEnv, out).heightMeters - field.sample(dE0.x, dE0.y, dE0.z, wallEnv, out).heightMeters) / (2 * hArc)
      const dN1 = d.clone().addScaledVector(n, hArc / R_M).normalize()
      const dN0 = d.clone().addScaledVector(n, -hArc / R_M).normalize()
      const fdN = (field.sample(dN1.x, dN1.y, dN1.z, wallEnv, out).heightMeters - field.sample(dN0.x, dN0.y, dN0.z, wallEnv, out).heightMeters) / (2 * hArc)
      worst = Math.max(worst, Math.abs(tE - fdE), Math.abs(tN - fdN))
    }
    expect(worst).toBeLessThan(2e-3)
  })

  it('страж констант: MIDBAND_GRAD_BOUND накрывает эмпирический max |∇snoise| (аналитический градиент, 100k точек); формула maxAmplitude', () => {
    const g: NoiseGrad3 = { value: 0, dx: 0, dy: 0, dz: 0 }
    let maxGrad = 0
    let maxAbs = 0
    for (let k = 0; k < 100000; k++) {
      // обход домена, независимый от решётки симплекса, без Math.random
      const x = 13.1 * Math.sin(k * 0.7311) + 0.017 * k
      const y = 9.7 * Math.cos(k * 1.1173) - 0.011 * k
      const z = 5.3 * Math.sin(k * 0.2931 + 2.0) + 0.007 * k
      snoiseGrad3(x, y, z, g)
      maxGrad = Math.max(maxGrad, Math.hypot(g.dx, g.dy, g.dz))
      maxAbs = Math.max(maxAbs, Math.abs(1 - Math.abs(g.value) - MIDBAND_RIDGE_MEAN))
    }
    expect(maxGrad * 1.1).toBeLessThanOrEqual(MIDBAND_GRAD_BOUND)
    expect(maxAbs).toBeLessThanOrEqual(MIDBAND_P99)
    // при провале НЕ подгонять тест: впиши в константу maxGrad·1.1 с округлением вверх до 0.5 и сообщи число
    const unit = new MidbandField({ ...MIDBAND_DEFAULTS, midbandFlat: 1, midbandRidge: 0 }, 1000, 1000 / (2 * Math.PI))
    expect(unit.maxAmplitudeMeters).toBeCloseTo(MIDBAND_ENVELOPE_MAX * MIDBAND_P99 * (30 + 15 + 7.5), 6)
  })

  it('страж среднего: E|snoise| по 100k точкам домена совпадает с (1 − MIDBAND_RIDGE_MEAN) в пределах 0.02', () => {
    const g: NoiseGrad3 = { value: 0, dx: 0, dy: 0, dz: 0 }
    let sumAbs = 0
    const N = 100000
    for (let k = 0; k < N; k++) {
      const x = 13.1 * Math.sin(k * 0.7311) + 0.017 * k
      const y = 9.7 * Math.cos(k * 1.1173) - 0.011 * k
      const z = 5.3 * Math.sin(k * 0.2931 + 2.0) + 0.007 * k
      snoiseGrad3(x, y, z, g)
      sumAbs += Math.abs(g.value)
    }
    const meanAbsSnoise = sumAbs / N
    // при провале — не подгонять тест: сообщить измеренное meanAbsSnoise и обновить MIDBAND_RIDGE_MEAN = 1 − meanAbsSnoise
    expect(Math.abs(meanAbsSnoise - (1 - MIDBAND_RIDGE_MEAN))).toBeLessThan(0.02)
  })

  it('среднее mid по 4000 направлениям при постоянной огибающей близко к 0 (тело не «толстеет»)', () => {
    // огибающая = flat 1 (ridge 0, slope 0 на flatEnv) — постоянна на всех направлениях,
    // изолирует центрирование гребневой октавы от модуляции огибающей
    const unitEnvelopeField = new MidbandField({ ...MIDBAND_DEFAULTS, midbandFlat: 1, midbandRidge: 0 }, LAMBDA0, R_M)
    let sum = 0
    const ds = dirs(4000)
    for (const d of ds) sum += unitEnvelopeField.sample(d.x, d.y, d.z, flatEnv, out).heightMeters
    const mean = sum / ds.length
    expect(Math.abs(mean)).toBeLessThan(0.05 * unitEnvelopeField.maxAmplitudeMeters)
  })

  it('p99AmplitudeBelowMeters — только октавы короче порога', () => {
    expect(field.p99AmplitudeBelowMeters(500)).toBeCloseTo(MIDBAND_ENVELOPE_MAX * MIDBAND_P99 * 12, 6)
    expect(field.p99AmplitudeBelowMeters(1000)).toBeCloseTo(MIDBAND_ENVELOPE_MAX * MIDBAND_P99 * (24 + 12), 6)
    expect(field.p99AmplitudeBelowMeters(5000)).toBeCloseTo(field.maxAmplitudeMeters, 6)
    expect(field.p99AmplitudeBelowMeters(100)).toBe(0)
  })
})

describe('MidbandField: веса октав по шагу вершин', () => {
  const field = new MidbandField(MIDBAND_DEFAULTS, LAMBDA0, R_M)
  const out: MidbandSample = { heightMeters: 0, tiltE: 0, tiltN: 0, octaveWeightSum: 0 }

  it('midbandOctaveWeight: 1 до step = LO·λ, 0 от step = HI·λ, монотонно между; step 0 — 1', () => {
    expect(MIDBAND_NYQUIST_LO).toBe(0.5)
    expect(MIDBAND_NYQUIST_HI).toBe(1)
    expect(midbandOctaveWeight(0, 400)).toBe(1)
    expect(midbandOctaveWeight(200, 400)).toBe(1)
    expect(midbandOctaveWeight(400, 400)).toBe(0)
    expect(midbandOctaveWeight(300, 400)).toBeCloseTo(0.5, 9)
    let prev = 1
    for (let s = 0; s <= 500; s += 10) {
      const w = midbandOctaveWeight(s, 400)
      expect(w).toBeLessThanOrEqual(prev + 1e-12)
      prev = w
    }
  })

  it('step 0 — бит-в-бит прежние числа; step = λ₂ (третья октава = 0) меняет высоту, octaveWeightSum = 2/3', () => {
    const d = dirs(1)[0]
    const full = { ...field.sample(d.x, d.y, d.z, wallEnv, out) }
    const again = { ...field.sample(d.x, d.y, d.z, wallEnv, out, 0) }
    expect(again).toEqual(full)
    expect(full.octaveWeightSum).toBe(1)
    const coarse = { ...field.sample(d.x, d.y, d.z, wallEnv, out, 400) }
    expect(coarse.octaveWeightSum).toBeCloseTo(2 / 3, 9)
    expect(coarse.heightMeters).not.toBeCloseTo(full.heightMeters, 6)
    // при step ≥ λ₀ все октавы гаснут — полосы нет, вес 0
    const gone = field.sample(d.x, d.y, d.z, wallEnv, out, 1600)
    expect(gone.heightMeters).toBe(0)
    expect(gone.tiltE).toBe(0)
    expect(gone.octaveWeightSum).toBe(0)
  })

  it('с шагом наклон = конечная разность высоты с тем же шагом (веса общие), допуск 2e-3 tan', () => {
    const hArc = 0.05
    const up = new Vector3(0, 1, 0)
    const step = 300 // третья октава на весу 0.5
    let worst = 0
    for (const d of dirs(200)) {
      const e = new Vector3().crossVectors(up, d).normalize()
      const n = new Vector3().crossVectors(d, e)
      const s = field.sample(d.x, d.y, d.z, wallEnv, out, step)
      const tE = s.tiltE
      const tN = s.tiltN
      const dE1 = d.clone().addScaledVector(e, hArc / R_M).normalize()
      const dE0 = d.clone().addScaledVector(e, -hArc / R_M).normalize()
      const fdE = (field.sample(dE1.x, dE1.y, dE1.z, wallEnv, out, step).heightMeters - field.sample(dE0.x, dE0.y, dE0.z, wallEnv, out, step).heightMeters) / (2 * hArc)
      const dN1 = d.clone().addScaledVector(n, hArc / R_M).normalize()
      const dN0 = d.clone().addScaledVector(n, -hArc / R_M).normalize()
      const fdN = (field.sample(dN1.x, dN1.y, dN1.z, wallEnv, out, step).heightMeters - field.sample(dN0.x, dN0.y, dN0.z, wallEnv, out, step).heightMeters) / (2 * hArc)
      worst = Math.max(worst, Math.abs(tE - fdE), Math.abs(tN - fdN))
    }
    expect(worst).toBeLessThan(2e-3)
  })

  it('отсечение: октавы короче cutoff не строятся; бонды по оставшимся', () => {
    // Земля: λ₀ 3000, шаг L8 610.8 м → cutoff 1221.6 → 750 отсекается
    const earth = new MidbandField(MIDBAND_DEFAULTS, 3000, 6371000, 1221.6)
    expect(earth.octaveCount).toBe(2)
    expect(earth.wavelengthsMeters).toEqual([3000, 1500])
    expect(earth.amplitudesMeters.map((a) => +a.toFixed(6))).toEqual([90, 45])
    expect(earth.maxAmplitudeMeters).toBeCloseTo(MIDBAND_ENVELOPE_MAX * MIDBAND_P99 * (90 + 45), 6)
    // Луна: cutoff 333 < 400 — все три
    const moon = new MidbandField(MIDBAND_DEFAULTS, LAMBDA0, R_M, 2 * 166.6)
    expect(moon.octaveCount).toBe(3)
    // без cutoff — как прежде
    expect(field.octaveCount).toBe(3)
  })

  it('residualAmplitudeMeters: 0 при step ≤ LO·λ_min, полный maxAmplitude при step ≥ HI·λ₀, между — часть', () => {
    expect(field.residualAmplitudeMeters(0)).toBe(0)
    expect(field.residualAmplitudeMeters(200)).toBe(0) // 200/400 = 0.5 → w = 1
    expect(field.residualAmplitudeMeters(1600)).toBeCloseTo(field.maxAmplitudeMeters, 6)
    // step 400: w₂ = 0 (400/400), w₁ = 1 (400/800 = 0.5), w₀ = 1 → остаток = A₂·P99·ENV_MAX
    expect(field.residualAmplitudeMeters(400)).toBeCloseTo(MIDBAND_ENVELOPE_MAX * MIDBAND_P99 * 12, 6)
  })

  it('octaveWeightSum считается до ранних выходов: strength 0 и нулевая огибающая всё равно отдают вес уровня', () => {
    const d = dirs(1)[0]
    const off = new MidbandField({ ...MIDBAND_DEFAULTS, midbandStrength: 0 }, LAMBDA0, R_M)
    const offFull = off.sample(d.x, d.y, d.z, wallEnv, out, 0)
    expect(offFull.heightMeters).toBe(0)
    expect(offFull.octaveWeightSum).toBe(1)
    const offCoarse = off.sample(d.x, d.y, d.z, wallEnv, out, 400)
    expect(offCoarse.heightMeters).toBe(0)
    expect(offCoarse.octaveWeightSum).toBeCloseTo(2 / 3, 9)

    const noEnvelope = new MidbandField({ ...MIDBAND_DEFAULTS, midbandFlat: 0 }, LAMBDA0, R_M)
    const zeroEnv: MidbandEnvelope = { slopeTan: 0, curvature: 0, downE: 1, downN: 0 }
    expect(noEnvelope.envelope(zeroEnv)).toBe(0)
    const envCoarse = noEnvelope.sample(d.x, d.y, d.z, zeroEnv, out, 400)
    expect(envCoarse.heightMeters).toBe(0)
    expect(envCoarse.octaveWeightSum).toBeCloseTo(2 / 3, 9)
  })

  it('отсечение: граница λ = cutoff включается (не строго меньше)', () => {
    const boundary = new MidbandField(MIDBAND_DEFAULTS, LAMBDA0, R_M, 400)
    expect(boundary.octaveCount).toBe(3) // λ₂ = 400 = cutoff, не короче — остаётся
    const justOver = new MidbandField(MIDBAND_DEFAULTS, LAMBDA0, R_M, 400.0001)
    expect(justOver.octaveCount).toBe(2) // λ₂ = 400 < 400.0001 — отсекается
  })
})
