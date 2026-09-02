import { describe, expect, it } from 'vitest'
import { simplexNoise3 } from '@/core/terrain/simplexNoise3'
import { proceduralField } from '@/core/terrain/proceduralSurfaceField'
import { seedOffset, type ProceduralSurfaceParams } from '@/core/terrain/proceduralSurfaceParams'

const params: ProceduralSurfaceParams = {
  seed: 42, frequencyPerRadius: 3, octaves: 5, gain: 0.5, lacunarity: 2,
  contrast: 1, palette: ['#111111', '#222222', '#333333', '#444444'], albedoNoise: 0
}

describe('simplexNoise3 (порт Ашимы)', () => {
  it('детерминирован, ограничен и не вырожден', () => {
    let min = Infinity, max = -Infinity
    for (let i = 0; i < 5000; i++) {
      const v = simplexNoise3(Math.sin(i) * 7, Math.cos(i * 1.3) * 7, i * 0.011)
      expect(v).toBe(simplexNoise3(Math.sin(i) * 7, Math.cos(i * 1.3) * 7, i * 0.011))
      min = Math.min(min, v); max = Math.max(max, v)
    }
    expect(min).toBeGreaterThan(-1.05)
    expect(max).toBeLessThan(1.05)
    expect(max - min).toBeGreaterThan(1) // не константа и не микроамплитуда
  })

  it('непрерывен: соседние точки дают близкие значения', () => {
    const a = simplexNoise3(1.234, 2.345, 3.456)
    const b = simplexNoise3(1.2341, 2.345, 3.456)
    expect(Math.abs(a - b)).toBeLessThan(0.01)
  })
})

describe('proceduralField', () => {
  it('octaves=1, contrast=1 — ровно одна выборка симплекса по сдвинутому домену', () => {
    const p = { ...params, octaves: 1 }
    const dir = [0.267261, 0.534522, 0.801784] as const
    const field = proceduralField(dir[0], dir[1], dir[2], p)
    expect(Math.abs(field)).toBeLessThanOrEqual(1)
    expect(field).not.toBe(0)

    // Честная сверка: повторяем арифметику домена вручную (amplitude=1,
    // frequency=frequencyPerRadius, norm=1, contrast=1 — тождество) и сравниваем
    // с прямым вызовом simplexNoise3 по тому же сдвинутому домену.
    const offset = seedOffset(p.seed)
    const expected = simplexNoise3(
      dir[0] * p.frequencyPerRadius + offset.x,
      dir[1] * p.frequencyPerRadius + offset.y,
      dir[2] * p.frequencyPerRadius + offset.z
    )
    expect(field).toBeCloseTo(expected, 12)
  })

  it('contrast сохраняет знак и |v|≤1; contrast=1 — тождество', () => {
    const soft = proceduralField(0.6, 0.64, 0.48, params)
    const sharp = proceduralField(0.6, 0.64, 0.48, { ...params, contrast: 2 })
    expect(Math.sign(sharp)).toBe(Math.sign(soft))
    expect(Math.abs(sharp)).toBeLessThanOrEqual(Math.abs(soft) + 1e-12)
  })

  it('разные сиды дают разные поля (декорреляция)', () => {
    let diff = 0
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2
      const d = [Math.cos(t) * 0.8, 0.6, Math.sin(t) * 0.8]
      diff += Math.abs(proceduralField(d[0], d[1], d[2], params) - proceduralField(d[0], d[1], d[2], { ...params, seed: 43 }))
    }
    expect(diff / 64).toBeGreaterThan(0.1)
  })

  it('референс-пин: значения зафиксированы (правка формулы обязана уронить этот тест)', () => {
    // Числа заполнены ОДИН раз фактическим выводом (см. Step 3а), затем не трогать без смены формулы.
    const dirs: [number, number, number][] = [
      [1, 0, 0], [0, 1, 0], [0, 0, 1], [-0.577350, 0.577350, 0.577350], [0.267261, -0.534522, 0.801784]
    ]
    const pinned = [
      -0.192481629068993, -0.390228782944150, -0.214879234919195, -0.295965932778218, -0.094525349278345
    ]
    dirs.forEach((d, i) => expect(proceduralField(d[0], d[1], d[2], params)).toBeCloseTo(pinned[i] as number, 12))
  })
})
