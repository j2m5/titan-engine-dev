import { config } from '@/core/framework/config'
import { streaming } from '@/config/streaming'

describe('streaming config: значения приёмки', () => {
  it('бюджет видеопамяти по умолчанию — 2 ГиБ', () => {
    expect(streaming.streaming.textureBudgetMiB).toBe(2048)
  })

  it('секция streaming доезжает до config()', () => {
    expect(config('streaming.textureBudgetMiB')).toBe(2048)
  })

  it('период пересчёта задан и разумен', () => {
    // Стенные часы, не эпоха симуляции: частота пересчёта не должна зависеть
    // от ускорения времени.
    const interval = config('streaming.recomputeIntervalMs')

    expect(typeof interval).toBe('number')
    expect(interval).toBeGreaterThan(0)
    expect(interval).toBeLessThanOrEqual(2000)
  })

  it('бэкофф ретрая задан и разумен', () => {
    const backoff = config('streaming.retryBackoffMs')

    expect(typeof backoff).toBe('number')
    expect(backoff).toBeGreaterThanOrEqual(1000)
  })
})
