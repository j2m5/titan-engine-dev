/** FIFO: новая версия заменяет только ещё не начатую страницу. */
export class ImpostorQueue<T extends { key: string }> {
  private jobs: { ticket: number; value: T }[] = []
  private serial = 0

  get watermark(): number { return this.serial }
  get size(): number { return this.jobs.length }

  enqueue(value: T): void {
    const pending = this.jobs.find(job => job.value.key === value.key)
    if (pending) pending.value = value
    else this.jobs.push({ ticket: ++this.serial, value })
  }

  shift(watermark = Infinity): T | null {
    if (!this.jobs.length || this.jobs[0].ticket > watermark) return null
    return this.jobs.shift()!.value
  }

  has(watermark = Infinity): boolean { return !!this.jobs.length && this.jobs[0].ticket <= watermark }
  remove(predicate: (value: T) => boolean): void { this.jobs = this.jobs.filter(job => !predicate(job.value)) }
  clear(): void { this.jobs = [] }
}
