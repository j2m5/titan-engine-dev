import { describe, it, expect, expectTypeOf } from 'vitest'
import { EventEmitter } from '@/core/framework/EventEmitter'

class Ticker extends EventEmitter<{ tick: [number]; done: [] }> {
  public run(): void {
    this.emit('tick', 1)
    this.emit('done')
  }
}

describe('EventEmitter: карта событий', () => {
  it('выводит типы аргументов подписчика из карты', () => {
    const ticker = new Ticker()

    ticker.subscribe('tick', (value) => {
      expectTypeOf(value).toEqualTypeOf<number>()
    })

    ticker.run()
  })

  it('доставляет аргументы подписчикам', () => {
    const ticker = new Ticker()
    const seen: number[] = []

    ticker.subscribe('tick', (value: number) => seen.push(value))
    ticker.run()

    expect(seen).toEqual([1])
  })

  it('колбэк без параметров подписывается на событие с аргументами', () => {
    const ticker = new Ticker()
    let calls = 0

    ticker.subscribe('tick', () => calls++)
    ticker.run()

    expect(calls).toBe(1)
  })

  it('отписка снимает конкретный колбэк', () => {
    const ticker = new Ticker()
    let calls = 0
    const onTick = (): void => {
      calls++
    }

    ticker.subscribe('tick', onTick)
    ticker.unsubscribe('tick', onTick)
    ticker.run()

    expect(calls).toBe(0)
  })

  it('не пропускает эмит с чужой формой аргументов', () => {
    const ticker = new Ticker()

    // @ts-expect-error tick объявлен как [number] — строка не подходит
    ticker.emit('tick', 'нет')
    // @ts-expect-error tick требует аргумент
    ticker.emit('tick')
    // @ts-expect-error done объявлен как [] — аргументов не принимает
    ticker.emit('done', 1)
    // @ts-expect-error события missing нет в карте
    ticker.emit('missing')
    // @ts-expect-error события missing нет в карте — subscribe обязан его отвергнуть
    ticker.subscribe('missing', () => {})
    // @ts-expect-error tick объявлен как [number] — подписчик со строкой не подходит
    ticker.unsubscribe('tick', (value: string) => value)

    expect(true).toBe(true)
  })
})
