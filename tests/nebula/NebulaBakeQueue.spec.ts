import { NebulaBakeQueue } from '@/core/renderables/Nebula/volume/NebulaBakeQueue'

describe('NebulaBakeQueue', () => {
  afterEach(() => vi.useRealTimers())

  it('finishes initial work in bounded chunks while yielding to the loading UI', async () => {
    vi.useFakeTimers()
    const queue = new NebulaBakeQueue({ maxStepsPerFrame: 2, maxCpuMs: Infinity })
    let steps = 0, completed = false
    const uiSteps: number[] = []
    setTimeout(() => uiSteps.push(steps), 0)
    queue.enqueue({}, () => ++steps === 5)
    const pending = queue.prepareInitial().then(() => { completed = true })
    expect(steps).toBe(2)
    expect(completed).toBe(false)
    await vi.runAllTimersAsync()
    await pending
    expect(uiSteps).toEqual([2])
    expect(steps).toBe(5)
    expect(queue.pendingCount).toBe(0)
  })

  it('stops a cancelled preparation before it can consume replacement scene jobs', async () => {
    vi.useFakeTimers()
    const queue = new NebulaBakeQueue({ maxStepsPerFrame: 1, maxCpuMs: Infinity })
    const old = {}
    let current = true, oldSteps = 0, newSteps = 0
    queue.enqueue(old, () => { oldSteps++; return false })
    const pending = queue.prepareInitial(() => current)
    expect(oldSteps).toBe(1)
    current = false
    queue.cancel(old)
    queue.enqueue({}, () => { newSteps++; return true })
    await vi.runAllTimersAsync()
    await pending
    expect(oldSteps).toBe(1)
    expect(newSteps).toBe(0)
    expect(queue.pendingCount).toBe(1)
  })

  it('does no work for an empty queue or a preparation cancelled before entry', async () => {
    vi.useFakeTimers()
    const queue = new NebulaBakeQueue()
    await queue.prepareInitial()
    let steps = 0
    queue.enqueue({}, () => { steps++; return true })
    await queue.prepareInitial(() => false)
    expect(steps).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

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
