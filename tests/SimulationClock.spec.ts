import { describe, it, expect, vi } from 'vitest'
import { SimulationClock } from '@/core/time/SimulationClock'
import { DAY } from '@/core/constants'

describe('SimulationClock', () => {
  it('продвигает epoch на (delta * speedOfTime) / DAY', () => {
    const clock = new SimulationClock(1000)
    clock.setSpeedOfTime(2)
    clock.advance(DAY) // delta = DAY → (DAY * 2) / DAY = 2
    expect(clock.epoch).toBeCloseTo(1002)
  })

  it('emit "change" при advance', () => {
    const clock = new SimulationClock(0)
    const cb = vi.fn()
    clock.subscribe('change', cb)
    clock.advance(1)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('setSpeedOfTime меняет скорость и эмитит change', () => {
    const clock = new SimulationClock(0)
    const cb = vi.fn()
    clock.subscribe('change', cb)
    clock.setSpeedOfTime(10)
    expect(clock.speedOfTime).toBe(10)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('setEpoch задаёт эпоху и эмитит change', () => {
    const clock = new SimulationClock(0)
    const cb = vi.fn()
    clock.subscribe('change', cb)
    clock.setEpoch(555)
    expect(clock.epoch).toBe(555)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
