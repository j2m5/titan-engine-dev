import { NebulaBakeQueue } from '@/core/renderables/Nebula/volume/NebulaBakeQueue'

describe('NebulaBakeQueue', () => {
  it('shares each frame between unfinished jobs and retains existing progress', () => {
    const queue = new NebulaBakeQueue({ maxStepsPerFrame: 2, maxCpuMs: Infinity })
    const order: string[] = []
    let a = 0, b = 0
    const key = {}
    queue.enqueue(key, () => { order.push('A'); return ++a === 3 })
    queue.enqueue({}, () => { order.push('B'); return ++b === 3 })
    queue.enqueue(key, () => { throw new Error('replacement') })
    queue.pumpFrame(); queue.pumpFrame(); queue.pumpFrame()
    expect(order).toEqual(['A', 'B', 'A', 'B', 'A', 'B'])
    expect(queue.pendingCount).toBe(0)
  })

  it('stops submitting after its CPU time budget', () => {
    let time = 0, steps = 0
    const queue = new NebulaBakeQueue({}, () => time)
    queue.enqueue({}, () => { steps++; time += 2; return false })
    queue.pumpFrame()
    expect(steps).toBe(1)
  })

  it('honors cancellation by a running job without requeueing it', () => {
    const queue = new NebulaBakeQueue({ maxCpuMs: Infinity })
    const key = {}
    let steps = 0
    queue.enqueue(key, () => { steps++; queue.cancel(key); return false })
    queue.pumpFrame()
    expect(steps).toBe(1)
    expect(queue.pendingCount).toBe(0)
  })

  it('cancels jobs and removes throwing jobs before rethrowing', () => {
    const queue = new NebulaBakeQueue({ maxCpuMs: Infinity })
    const key = {}
    queue.enqueue(key, () => { throw new Error('cancelled') })
    queue.cancel(key)
    queue.pumpFrame()
    queue.enqueue(key, () => { throw new Error('draw failed') })
    expect(() => queue.pumpFrame()).toThrow('draw failed')
    expect(queue.pendingCount).toBe(0)
  })

  it('accounts reservations without leaking replaced or denied allocations', () => {
    const queue = new NebulaBakeQueue({ maxTextureBytes: 10 })
    const a = {}, b = {}
    expect(queue.reserve(a, 8)).toBe(true)
    expect(queue.reserve(a, 8)).toBe(true)
    expect(queue.reserve(b, 3)).toBe(false)
    expect(queue.allocatedBytes).toBe(8)
    queue.release(a)
    expect(queue.reserve(b, 3)).toBe(true)
    expect(queue.allocatedBytes).toBe(3)
  })
})
