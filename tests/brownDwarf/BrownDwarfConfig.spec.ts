import { config } from '@/core/framework/config'
import { brownDwarf } from '@/config/brownDwarf'

describe('конфиг коричневого карлика', () => {
  it('доезжает до общего config()', () => {
    expect(config('brownDwarf.cubeSize')).toBe(2048)
    expect(config('brownDwarf.advectionSteps')).toBe(24)
    expect(config('brownDwarf.noiseInjection')).toBeCloseTo(0.05)
    expect(config('brownDwarf.lodHysteresis')).toBeCloseTo(0.05)
  })

  it('грань кубмапы — степень двойки: иначе мипы неполные', () => {
    const size = brownDwarf.brownDwarf.cubeSize

    expect(Number.isInteger(Math.log2(size))).toBe(true)
  })
})
