import { describe, it, expect } from 'vitest'
import { TimeStore } from '@/ui/mobx/TimeStore'
import { SimulationClock } from '@/core/time/SimulationClock'

/** Свежий стор, подключённый к часам на заданной скорости */
function storeAt(speed: number): { store: TimeStore; clock: SimulationClock } {
  const clock = new SimulationClock(2460000)
  const store = new TimeStore()

  clock.setSpeedOfTime(speed)
  store.connect(clock)

  return { store, clock }
}

describe('TimeStore: пауза и продолжение', () => {
  it('Rewind с 1x уводит в паузу, Play возвращает 1x — а не стоит на нуле', () => {
    const { store, clock } = storeAt(1)

    store.setSpeedBackward()
    expect(clock.speedOfTime).toBe(0)

    store.togglePause()
    expect(clock.speedOfTime).toBe(1)
  })

  it('пауза кнопкой на 1000x и Play — снова 1000x', () => {
    const { store, clock } = storeAt(1000)

    store.togglePause()
    expect(clock.speedOfTime).toBe(0)

    store.togglePause()
    expect(clock.speedOfTime).toBe(1000)
  })

  it('последняя скорость помнится при любой смене, не только кнопкой паузы', () => {
    const { store, clock } = storeAt(1)

    store.setSpeedForward()
    store.setSpeedForward()
    expect(clock.speedOfTime).toBe(25)

    // пауза не кнопкой, а установкой нуля (как Rewind до конца)
    store.setSpeedOfTime(0)
    store.togglePause()

    expect(clock.speedOfTime).toBe(25)
  })

  it('Play без истории (часы стартовали на паузе) — 1x', () => {
    const { store, clock } = storeAt(0)

    store.togglePause()

    expect(clock.speedOfTime).toBe(1)
  })

  it('Fast Forward с паузы — первый шаг, 1x', () => {
    const { store, clock } = storeAt(0)

    store.setSpeedForward()

    expect(clock.speedOfTime).toBe(1)
  })

  it('скорость не из списка шагов кнопками не двигается, как и раньше', () => {
    const { store, clock } = storeAt(7)

    store.setSpeedForward()
    store.setSpeedBackward()

    expect(clock.speedOfTime).toBe(7)
  })

  it('на максимуме Fast Forward ничего не делает', () => {
    const max = 10000000
    const { store, clock } = storeAt(max)

    store.setSpeedForward()

    expect(clock.speedOfTime).toBe(max)
  })
})
