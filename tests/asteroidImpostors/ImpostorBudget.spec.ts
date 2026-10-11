import { atlasBytes, instanceAttributeBytes, ImpostorBudget, textureBytes } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorBudget'
import { createImpostorLayout } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'

describe('резерв GPU-памяти импосторов', () => {
  it('учитывает оба массива, запасной слой и неиспользуемые нижние mip', () => {
    expect(atlasBytes(createImpostorLayout(8, 64), 14)).toBe(41_943_000)
    expect(textureBytes(3, 5, 2, 3, 4)).toBe(144)
    expect(instanceAttributeBytes([50_000, 20_000, 100_000])).toBe(1_360_000)
  })

  it('позволяет четыре библиотеки с общим scratch и отказывает пятой до allocation', () => {
    const budget = new ImpostorBudget(192 * 1024 ** 2)
    const scratch = {}
    expect(budget.reserve(scratch, 6 * 1024 ** 2)).toBe(true)
    for (let i = 0; i < 4; i++) {
      const owner = {}
      expect(budget.reserve(owner, 41_943_000 + 1_360_000)).toBe(true)
      budget.commit(owner)
    }
    const before = budget.snapshot()
    expect(budget.reserve({}, 41_943_000)).toBe(false)
    expect(budget.snapshot()).toEqual(before)
    expect(before.allocatedBytes).toBe(173_212_000)
    expect(before.reservedBytes).toBe(6 * 1024 ** 2)
  })

  it('не дублирует владельца и освобождает квоту после неудачного создания', () => {
    const budget = new ImpostorBudget(100)
    const owner = {}
    expect(budget.reserve(owner, 60)).toBe(true)
    expect(budget.reserve(owner, 60)).toBe(true)
    budget.commit(owner, 40)
    expect(budget.snapshot()).toEqual({ allocatedBytes: 40, reservedBytes: 20, peakBytes: 60 })
    expect(budget.reserve(owner, 30)).toBe(false)
    expect(budget.reserve({}, 50)).toBe(false)
    budget.release(owner)
    budget.release(owner)
    expect(budget.snapshot()).toEqual({ allocatedBytes: 0, reservedBytes: 0, peakBytes: 60 })
    expect(budget.reserve({}, 100)).toBe(true)
  })

  it('не даёт подтвердить несуществующий или слишком маленький резерв', () => {
    const budget = new ImpostorBudget(100)
    const owner = {}
    expect(() => budget.commit(owner)).toThrow()
    budget.reserve(owner, 20)
    expect(() => budget.commit(owner, 21)).toThrow()
    expect(() => budget.reserve({}, NaN)).toThrow(RangeError)
    expect(() => budget.reserve({}, -1)).toThrow(RangeError)
  })
})
