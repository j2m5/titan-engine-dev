interface NebulaBakeBudget {
  maxStepsPerFrame: number
  maxCpuMs: number
  maxTextureBytes: number
}

/** Shared submission and residency budget for all nebula bake work. */
class NebulaBakeQueue {
  private readonly jobs = new Map<object, () => boolean>()
  private readonly reservations = new Map<object, number>()
  private readonly budget: NebulaBakeBudget
  private bytes = 0

  public constructor(options: Partial<NebulaBakeBudget> = {}, private readonly now = () => performance.now()) {
    this.budget = { maxStepsPerFrame: 4, maxCpuMs: 2, maxTextureBytes: 64 * 1024 * 1024, ...options }
  }

  public enqueue(key: object, step: () => boolean): void {
    if (!this.jobs.has(key)) this.jobs.set(key, step)
  }

  public cancel(key: object): void { this.jobs.delete(key) }

  public pumpFrame(): void {
    const start = this.now()
    for (let i = 0; i < this.budget.maxStepsPerFrame && this.jobs.size > 0; i++) {
      if (this.now() - start >= this.budget.maxCpuMs) break
      const [key, step] = this.jobs.entries().next().value!
      let complete: boolean
      try {
        complete = step()
      } catch (error) {
        this.jobs.delete(key)
        throw error
      }
      if (this.jobs.get(key) === step) {
        this.jobs.delete(key)
        if (!complete) this.jobs.set(key, step)
      }
    }
  }

  public reserve(key: object, bytes: number): boolean {
    if (!Number.isFinite(bytes) || bytes < 0) return false
    const total = this.bytes - (this.reservations.get(key) ?? 0) + bytes
    if (total > this.budget.maxTextureBytes) return false
    this.reservations.set(key, bytes)
    this.bytes = total
    return true
  }

  public release(key: object): void {
    this.bytes -= this.reservations.get(key) ?? 0
    this.reservations.delete(key)
  }

  public get pendingCount(): number { return this.jobs.size }
  public get allocatedBytes(): number { return this.bytes }
}

export { NebulaBakeQueue }
export type { NebulaBakeBudget }
