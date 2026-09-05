import { describe, expect, it } from 'vitest'
import { simplexNoise3, snoiseGrad3, type NoiseGrad3 } from '@/core/terrain/simplexNoise3'

function points(n: number): Array<[number, number, number]> {
  // детерминированный обход домена без Math.random (паттерн guard-тестов архива)
  return Array.from({ length: n }, (_, k) => [
    7.3 * Math.sin(k * 0.731) + 0.13 * k,
    5.1 * Math.cos(k * 1.117) - 0.07 * k,
    3.7 * Math.sin(k * 0.293 + 1.0) + 0.05 * k
  ])
}

describe('snoiseGrad3: значение и аналитический градиент', () => {
  const out: NoiseGrad3 = { value: 0, dx: 0, dy: 0, dz: 0 }

  it('значение совпадает с simplexNoise3 бит-в-бит', () => {
    for (const [x, y, z] of points(2000)) {
      expect(snoiseGrad3(x, y, z, out).value).toBe(simplexNoise3(x, y, z))
    }
  })

  it('градиент совпадает с центральной разностью (h = 1e-5, допуск 1e-3 относительно шкалы градиента)', () => {
    const h = 1e-5
    let worst = 0
    for (const [x, y, z] of points(3000)) {
      const g = snoiseGrad3(x, y, z, out)
      const fdx = (simplexNoise3(x + h, y, z) - simplexNoise3(x - h, y, z)) / (2 * h)
      const fdy = (simplexNoise3(x, y + h, z) - simplexNoise3(x, y - h, z)) / (2 * h)
      const fdz = (simplexNoise3(x, y, z + h) - simplexNoise3(x, y, z - h)) / (2 * h)
      // на стыках симплексов разность через ребро даёт скачок — пропускаем точки, где FD сама несогласована
      const fdx2 = (simplexNoise3(x + 2 * h, y, z) - simplexNoise3(x - 2 * h, y, z)) / (4 * h)
      if (Math.abs(fdx - fdx2) > 1e-3) continue
      worst = Math.max(worst, Math.abs(g.dx - fdx), Math.abs(g.dy - fdy), Math.abs(g.dz - fdz))
    }
    expect(worst).toBeLessThan(1e-3)
  })

  it('пишет в out и возвращает его же (без аллокаций)', () => {
    expect(snoiseGrad3(0.3, 0.7, 1.9, out)).toBe(out)
  })
})
