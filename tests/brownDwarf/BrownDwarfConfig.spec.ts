import { config } from '@/core/framework/config'

describe('конфиг коричневого карлика', () => {
  it('доезжает до общего config()', () => {
    expect(config('brownDwarf.lodHysteresis')).toBeCloseTo(0.05)
  })
})
