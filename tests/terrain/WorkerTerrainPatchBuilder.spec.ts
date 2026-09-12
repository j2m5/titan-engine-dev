import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerTerrainPatchBuilder, type WorkerLike } from '@/core/terrain/worker/WorkerTerrainPatchBuilder'
import { createWorkerState, handleWorkerMessage } from '@/core/terrain/worker/terrainBuildHandler'
import type { FromWorkerMessage, ToWorkerMessage } from '@/core/terrain/worker/terrainBuildProtocol'
import type { PatchBuildResult } from '@/core/terrain/terrainPatchBuilder'
import type { PatchArrays } from '@/core/terrain/terrainPatchGeometry'
import type { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { expectMatchesFreshBuild, makeField, patchJob, snapshotArrays } from './workerBuildHelpers'

/** Воркер в том же потоке: сообщения копятся, pump() прогоняет их через настоящий обработчик (переносы не нужны). */
class FakeWorker implements WorkerLike {
  public readonly sent: ToWorkerMessage[] = []
  public readonly transferLengths: number[] = []
  public terminated = false
  public onmessage: ((ev: { data: FromWorkerMessage }) => void) | null = null
  public onerror: ((reason: string) => void) | null = null
  public onmessageerror: ((reason: string) => void) | null = null
  private readonly queue: ToWorkerMessage[] = []
  private readonly state = createWorkerState()

  public postMessage(message: ToWorkerMessage, transfer: Transferable[]): void {
    this.sent.push(message)
    this.transferLengths.push(transfer.length)
    this.queue.push(message)
  }

  public pump(): void {
    for (const message of this.queue.splice(0)) {
      const out = handleWorkerMessage(this.state, message)
      if (out) this.emit(out.message)
    }
  }

  public emit(message: FromWorkerMessage): void {
    this.onmessage?.({ data: message })
  }

  public fail(kind: 'onerror' | 'onmessageerror', reason: string): void {
    this[kind]?.(reason)
  }

  public terminate(): void {
    this.terminated = true
  }
}

describe('WorkerTerrainPatchBuilder: строитель поверх воркера', () => {
  it('регистрация поля один раз на два запроса; приходы вызывают onDone с массивами ядра; release при нуле ссылок шлёт releaseField', () => {
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const results: PatchBuildResult[] = []
    const job = patchJob(field, 0, 1, 0)
    const job2 = { ...job, i: 0 }
    builder.request(job, (r) => results.push(r))
    builder.request(job2, (r) => results.push(r))
    expect(worker.sent.filter((m) => m.type === 'registerField')).toHaveLength(1)
    expect(worker.sent.filter((m) => m.type === 'build')).toHaveLength(2)
    expect(worker.transferLengths[worker.sent.findIndex((m) => m.type === 'registerField')]).toBeGreaterThanOrEqual(1)
    worker.pump()
    expect(results).toHaveLength(2)
    expectMatchesFreshBuild(results[0].arrays, job)
    expectMatchesFreshBuild(results[1].arrays, job2)
    // две группы на одно поле: acquire×2 → release×2, releaseField ровно один раз, при нуле ссылок
    builder.acquire(field)
    builder.acquire(field)
    builder.release(field)
    expect(worker.sent.filter((m) => m.type === 'releaseField')).toHaveLength(0)
    builder.release(field)
    expect(worker.sent.filter((m) => m.type === 'releaseField')).toHaveLength(1)
    expect(worker.sent.filter((m) => m.type === 'registerField')).toHaveLength(1) // повторной регистрации не было
  })

  it('регистрация уходит раньше первого build; releaseAll снимает все поля; dispose завершает воркер, поздний приход не зовёт onDone', () => {
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const a = makeField(),
      b = makeField()
    const job = (field: TerrainHeightField) => patchJob(field, 0, 0, 0, 0)
    builder.acquire(a)
    builder.acquire(b)
    let calls = 0
    builder.request(job(a), () => calls++)
    builder.request(job(b), () => calls++)
    const types = worker.sent.map((m) => m.type)
    expect(types.indexOf('registerField')).toBeLessThan(types.indexOf('build'))
    builder.releaseAll()
    expect(worker.sent.filter((m) => m.type === 'releaseField')).toHaveLength(2)
    builder.dispose()
    expect(worker.terminated).toBe(true)
    worker.pump() // ответы на build уже в очереди фейка — после dispose игнорируются
    expect(calls).toBe(0)
  })
})

describe('WorkerTerrainPatchBuilder: отказ воркера — откат на синхронный строитель', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function setup() {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const jobA = patchJob(field, 0, 1, 0)
    const jobB = patchJob(field, 3, 0, 1)
    const a: PatchArrays[] = []
    const b: PatchArrays[] = []
    builder.request(jobA, (r) => a.push(snapshotArrays(r.arrays)))
    builder.request(jobB, (r) => b.push(snapshotArrays(r.arrays)))
    return { warn, worker, builder, field, jobA, jobB, a, b }
  }

  it.each(['onerror', 'onmessageerror'] as const)(
    '%s при двух заданиях в полёте: оба пересобраны синхронно, следующий запрос отвечает сразу, warn один раз',
    (kind) => {
      const { warn, worker, builder, field, jobA, jobB, a, b } = setup()
      worker.fail(kind, 'модуль воркера не загрузился')
      expect(a).toHaveLength(1)
      expect(b).toHaveLength(1)
      expectMatchesFreshBuild(a[0], jobA)
      expectMatchesFreshBuild(b[0], jobB)
      expect(worker.terminated).toBe(true)

      const sentBefore = worker.sent.length
      const jobC = patchJob(field, 5, 1, 1)
      const c: PatchArrays[] = []
      builder.request(jobC, (r) => c.push(snapshotArrays(r.arrays)))
      expect(c).toHaveLength(1) // синхронно, внутри request
      expectMatchesFreshBuild(c[0], jobC)
      builder.acquire(field)
      builder.release(field)
      builder.releaseAll()
      expect(worker.sent).toHaveLength(sentBefore) // воркеру больше ничего не уходит

      worker.fail(kind, 'повторный сбой')
      expect(warn).toHaveBeenCalledTimes(1)
      builder.dispose()
    }
  )

  it('error-ответ по одному запросу — тот же откат: пересобраны все задания в полёте', () => {
    const { warn, worker, jobA, jobB, a, b } = setup()
    const buildIds = worker.sent.flatMap((m) => (m.type === 'build' ? [m.requestId] : []))
    worker.emit({ type: 'error', requestId: buildIds[1], message: 'сбой постройки' })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expectMatchesFreshBuild(a[0], jobA)
    expectMatchesFreshBuild(b[0], jobB)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('built старого воркера после отказа не зовёт onDone второй раз', () => {
    const { worker, a, b } = setup()
    worker.fail('onerror', 'сбой')
    worker.pump() // registerField и оба build ещё в очереди фейка — их built приходят после отказа
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })
})
