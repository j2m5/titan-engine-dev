import { config } from '@/core/framework/config'
import { streaming } from '@/config/streaming'

describe('streaming config: значения приёмки', () => {
  it('бюджет видеопамяти по умолчанию — 2 ГиБ', () => {
    expect(streaming.streaming.textureBudgetMiB).toBe(2048)
  })

  it('секция streaming доезжает до config()', () => {
    expect(config('streaming.textureBudgetMiB')).toBe(2048)
  })
})
