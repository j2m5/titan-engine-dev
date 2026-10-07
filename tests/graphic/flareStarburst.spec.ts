import { describe, expect, it } from 'vitest'
import {
  STARBURST_ANGLES_DEG,
  STARBURST_CORE,
  STARBURST_DISPERSION,
  STARBURST_EPSILON,
  STARBURST_MAX_LENGTH,
  STARBURST_TAPER_START,
  spikeIntensity,
  starburstQuadHalfSize,
  starburstVisibleLength,
  starburstWindow,
  starburstWeight
} from '@/core/graphic/effects/lensflare/flareStarburst'

describe('starburst: геометрия', () => {
  it('шесть лучей на трёх линиях 30°, 90°, 150° — горизонтали нет', () => {
    expect([...STARBURST_ANGLES_DEG]).toEqual([30, 90, 150])
    for (const a of STARBURST_ANGLES_DEG) expect(Math.abs(Math.sin((a * Math.PI) / 180))).toBeGreaterThan(0.4)
  })

  it('дисперсия: красный длиннее, синий короче', () => {
    const [r, g, b] = STARBURST_DISPERSION
    expect(r).toBeLessThan(g)
    expect(b).toBeGreaterThan(g)
  })
})

describe('starburst: длина и энергия', () => {
  it('калибровка: звезда 12 px (поток 3400) — видимая длина 0.25 высоты кадра', () => {
    expect(starburstVisibleLength(3400, 1, 0.1)).toBeCloseTo(0.25, 10)
  })

  it('белый карлик 6 px (поток 1100) — около 0.14', () => {
    expect(starburstVisibleLength(1100, 1, 0.1)).toBeCloseTo(0.14, 2)
  })

  it('длина растёт как √F: учетверённый поток — вдвое длиннее', () => {
    const ratio = starburstVisibleLength(4 * 3400, 1, 0.1) / starburstVisibleLength(3400, 1, 0.1)
    expect(ratio).toBeGreaterThan(2)
    expect(ratio).toBeLessThan(2.05)
  })

  it('квад покрывает красный канал ровно до ε', () => {
    const half = starburstQuadHalfSize(0.1)
    expect(half).toBeGreaterThan(STARBURST_CORE)
    expect(half).toBeLessThan(STARBURST_MAX_LENGTH)
    expect(spikeIntensity(half, 0.1, STARBURST_DISPERSION[0])).toBeCloseTo(STARBURST_EPSILON, 10)
  })

  it('квад не короче ядра и не длиннее потолка', () => {
    expect(starburstQuadHalfSize(1e-4)).toBe(STARBURST_CORE)
    expect(starburstQuadHalfSize(52)).toBe(STARBURST_MAX_LENGTH)
  })

  it('вход лучей плавный: у порога 0, на удвоенном пороге 1', () => {
    expect(starburstWeight(200, 200)).toBe(0)
    expect(starburstWeight(300, 200)).toBeCloseTo(0.5, 10)
    expect(starburstWeight(400, 200)).toBe(1)
  })

  it('нулевой порог — лучи у всех выбранных источников', () => {
    expect(starburstWeight(1, 0)).toBe(1)
  })

  it('фоновая звезда (поток 3) лучей не получает', () => {
    expect(starburstWeight(3, 200)).toBe(0)
  })

  it('окно луча: 1 до 0.7·h, 0 на h и дальше, 0.5 посередине, монотонно', () => {
    const h = 0.4
    expect(STARBURST_TAPER_START).toBe(0.7)
    expect(starburstWindow(0, h)).toBe(1)
    expect(starburstWindow(0.7 * h, h)).toBe(1)
    expect(starburstWindow(h, h)).toBe(0)
    expect(starburstWindow(1.2 * h, h)).toBe(0)
    expect(starburstWindow(0.85 * h, h)).toBeCloseTo(0.5, 10)
    let previous = 1
    for (let i = 0; i <= 20; i++) {
      const value = starburstWindow((0.7 + 0.015 * i) * h, h)
      expect(value).toBeLessThanOrEqual(previous + 1e-12)
      previous = value
    }
  })
})
