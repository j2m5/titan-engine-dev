import { ImpostorQueue } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorQueue'

describe('Очередь страниц импосторов', () => {
  it('объединяет только не начатые ревизии, сохраняя FIFO и границу initial', () => {
    const queue = new ImpostorQueue<{ key: string; version: number }>()
    queue.enqueue({ key: 'a:0', version: 0 })
    queue.enqueue({ key: 'b:0', version: 0 })
    const boundary = queue.watermark
    queue.enqueue({ key: 'a:0', version: 1 })
    expect(queue.shift(boundary)?.version).toBe(1)
    queue.enqueue({ key: 'a:0', version: 2 })
    expect(queue.shift(boundary)?.key).toBe('b:0')
    expect(queue.shift(boundary)).toBeNull()
    expect(queue.size).toBe(1)
    expect(queue.shift()?.version).toBe(2)
  })

  it('отменяет библиотеку, не удаляя соседей', () => {
    const queue = new ImpostorQueue<{ key: string }>()
    queue.enqueue({ key: 'a:0' }); queue.enqueue({ key: 'b:0' })
    queue.remove(job => job.key.startsWith('a:'))
    expect(queue.size).toBe(1)
    expect(queue.shift()?.key).toBe('b:0')
    queue.clear()
    expect(queue.shift()).toBeNull()
  })
})
