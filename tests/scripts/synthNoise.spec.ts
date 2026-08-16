import { describe, expect, it } from 'vitest'
import { synthBaseField, synthValueNoise3 } from '../../scripts/lib/synthNoise'

describe('synthValueNoise3: сидированный value-noise', () => {
  it('детерминизм по сиду; другой сид даёт другое поле', () => {
    const a1 = synthValueNoise3(1.37, -2.91, 0.42, 1)
    const a2 = synthValueNoise3(1.37, -2.91, 0.42, 1)
    const b = synthValueNoise3(1.37, -2.91, 0.42, 2)

    expect(a1).toBe(a2)
    expect(a1).not.toBe(b)
  })

  it('диапазон [-1.1, 1.1] и не-константность на 10k точек', () => {
    let min = Infinity
    let max = -Infinity

    for (let i = 0; i < 10000; i++) {
      const x = i * 0.0173
      const y = i * 0.0271
      const z = i * 0.0413
      const seed = (i % 7) + 1
      const v = synthValueNoise3(x, y, z, seed)

      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(-1.1)
      expect(v).toBeLessThanOrEqual(1.1)

      if (v < min) min = v
      if (v > max) max = v
    }

    // не константа: реальный размах шума, не вырожденная фикстура
    expect(max - min).toBeGreaterThan(0.5)
  })
})

describe('synthBaseField: спектральный бонд подложки', () => {
  it('вдоль большого круга разность соседних сэмплов не превышает аналитический бонд производной (рябь короче λ_мин невозможна по построению)', () => {
    // Вывод бонда (см. докблок synthNoise.ts):
    //   - трилинейная интерполяция значений решётки в [-1,1] с квинтик-фейдом
    //     Перлина fade(t)=6t^5-15t^4+10t^3, fade'(t)=30t²(t-1)², максимум в
    //     t=0.5: fade'(0.5) = 30·0.25·0.25 = 15/8;
    //   - по любой оси решётки |∂f/∂x_k| ≤ fade'_max · Δh_max = (15/8)·2 = 15/4
    //     (Δh_max=2 — худшая разность двух хеш-значений в [-1,1] на соседних
    //     узлах решётки; частная производная сходится к взвешенной сумме таких
    //     разностей с весами, суммирующимися в 1, — суммарно не может превысить
    //     сам предел одной разности);
    //   - для единичного направления по Коши-Буняковскому:
    //     |∇f·u| ≤ sqrt((15/4)²·3) = (15/4)·√3;
    //   - подложка — Σ октав amp_o·f(freq_o·dir(t)), freq_o=baseFrequency·2^o,
    //     amp_o нормирована так, что Σamp_o=1 (amp_o=amp0·0.5^o,
    //     amp0=1/(2·(1-0.5^octaves))); при этом amp_o·freq_o = amp0·baseFrequency
    //     ОДИНАКОВО для каждой октавы (halving амплитуды компенсируется
    //     doubling частоты), поэтому по цепному правилу вдоль
    //     unit-speed параметризации большого круга (|d dir/dt|=1):
    //       max|∂(synthBaseField)/∂t| ≤ octaves·amp0·baseFrequency·(15/4)·√3
    //   - разность соседних сэмплов (шаг Δt=2π/samples) ограничена этим
    //     максимумом производной, умноженным на Δt (Лагранж/Липшиц: fade — C¹,
    //     значит f и вся сумма октав C¹, бонд глобален, не только внутри ячейки).
    const octaves = 3
    const baseFrequency = 4 // λ0 = 2π/4 = π/2 = четверть окружности единичной сферы (2π)
    const seed = 7
    const samples = 1024
    const step = (2 * Math.PI) / samples

    const values: number[] = []
    for (let i = 0; i < samples; i++) {
      const t = i * step
      values.push(synthBaseField(Math.cos(t), 0, Math.sin(t), seed, octaves, baseFrequency))
    }

    const totalWeight = 2 * (1 - Math.pow(0.5, octaves))
    const amp0 = 1 / totalWeight
    const gradientBound = (15 / 4) * Math.sqrt(3)
    const maxDerivative = octaves * amp0 * baseFrequency * gradientBound
    const maxAdjacentDiff = maxDerivative * step

    let observedMax = 0
    for (let i = 0; i < samples - 1; i++) {
      const diff = Math.abs(values[i + 1] - values[i])
      if (diff > observedMax) observedMax = diff
      expect(diff).toBeLessThan(maxAdjacentDiff)
    }

    // сам факт нетривиальных перепадов — бонд не должен маскировать
    // вырожденную (константную) подложку
    expect(observedMax).toBeGreaterThan(0)
  })
})
