import { describe, expect, it } from 'vitest'
import { buildCavityField } from '../../scripts/lib/cavityMap'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

function makeMap(width: number, height: number, values: number[]): HeightMapData {
  return { width, height, minMeters: 0, maxMeters: 65535, data: new Uint16Array(values) }
}

describe('buildCavityField: полость рельефа из карты высот', () => {
  it('плоское поле даёт нули на всей карте (все полосы пусты — деление на p99 пропущено)', () => {
    const width = 8
    const height = 6
    const field = buildCavityField(makeMap(width, height, new Array(width * height).fill(30000)))

    expect(field.length).toBe(width * height)
    for (const v of field) expect(v).toBe(0)
  })

  it('детерминизм: два вызова на одном входе дают байт-в-байт идентичный результат', () => {
    const width = 32
    const height = 16
    const values = new Array(width * height)
    for (let i = 0; i < values.length; i++) values[i] = (i * 37) % 5000
    const map = makeMap(width, height, values)

    const a = buildCavityField(map)
    const b = buildCavityField(map)

    expect(Array.from(a)).toEqual(Array.from(b))
  })

  // Поле 512×256 × 5 DoG-полос — тяжёлый числовой прогон: ~2.7 с в одиночку,
  // под полным параллельным прогоном сюиты не влезает в дефолтные 5 с.
  it('одиночная гауссова яма: центр отрицателен, вал вокруг положителен, диапазон ⊂ [−1, 1]', { timeout: 20000 }, () => {
    // домен заведомо больше самой широкой полосы (σ_low=32 текселя), яма вдали
    // от полюсов и шва долготы — профиль читается без краевых искажений
    const width = 512
    const height = 256
    const cx = 256
    const cy = 128
    const sigmaPit = 3
    const baseline = 30000
    const depth = 20000

    const values = new Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx
        const dy = y - cy
        const g = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaPit * sigmaPit))
        values[y * width + x] = Math.round(baseline - depth * g)
      }
    }

    const field = buildCavityField(makeMap(width, height, values))

    for (const v of field) {
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }

    // центр ямы: узкий блюр держит форму ямы, широкий размывает её к нулю —
    // разность отрицательна (см. докблок cavityMap.ts, «мексиканская шляпа»)
    expect(field[cy * width + cx]).toBeLessThan(0)

    // вал вокруг ямы (r≈10 текселей — за пределами самой ямы, sigmaPit=3):
    // положительный обод, компенсирующий отрицательный центр
    expect(field[cy * width + (cx + 10)]).toBeGreaterThan(0)
    expect(field[cy * width + (cx - 10)]).toBeGreaterThan(0)
    expect(field[(cy + 10) * width + cx]).toBeGreaterThan(0)
    expect(field[(cy - 10) * width + cx]).toBeGreaterThan(0)
  })

  it('знак: изолированный гребень (выступ) даёт положительный центр — зеркально яме', () => {
    const width = 512
    const height = 256
    const cx = 256
    const cy = 128
    const sigmaBump = 3
    const baseline = 30000
    const amplitude = 20000

    const values = new Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx
        const dy = y - cy
        const g = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaBump * sigmaBump))
        values[y * width + x] = Math.round(baseline + amplitude * g)
      }
    }

    const field = buildCavityField(makeMap(width, height, values))

    expect(field[cy * width + cx]).toBeGreaterThan(0)
  })
})
