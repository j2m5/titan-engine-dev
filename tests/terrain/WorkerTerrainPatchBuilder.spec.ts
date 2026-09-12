import { describe, expect, it } from 'vitest'
import { WorkerTerrainPatchBuilder, type WorkerLike } from '@/core/terrain/worker/WorkerTerrainPatchBuilder'
import { createWorkerState, handleWorkerMessage } from '@/core/terrain/worker/terrainBuildHandler'
import type { FromWorkerMessage, ToWorkerMessage } from '@/core/terrain/worker/terrainBuildProtocol'
import type { PatchBuildResult } from '@/core/terrain/terrainPatchBuilder'
import { buildTerrainPatchGeometry, buildPatchIndex } from '@/core/terrain/terrainPatchGeometry'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

// как в TerrainPatchGroupBudget.spec: 64×32, радиус Луны
function makeField(): TerrainHeightField {
  const width = 64
  const height = 32
  const data = new Uint16Array(width * height)
  for (let k = 0; k < data.length; k++) data[k] = (k * 4001) % 65535

  const map: HeightMapData = { width, height, minMeters: 0, maxMeters: 1000, data }
  return new TerrainHeightField(map, 1737.4)
}

/** Воркер в том же потоке: сообщения копятся, pump() прогоняет их через настоящий обработчик (переносы не нужны). */
class FakeWorker implements WorkerLike {
  public readonly sent: ToWorkerMessage[] = []
  public readonly transferLengths: number[] = []
  public terminated = false
  public onmessage: ((ev: { data: FromWorkerMessage }) => void) | null = null
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
      if (out) this.onmessage?.({ data: out.message })
    }
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
    const job = { field, face: 0, i: 1, j: 0, level: 1, segments: 8, skirtDepthUnits: 0.001, wrap: detailWrapFor(undefined) }
    builder.request(job, (r) => results.push(r))
    builder.request({ ...job, i: 0 }, (r) => results.push(r))
    expect(worker.sent.filter((m) => m.type === 'registerField')).toHaveLength(1)
    expect(worker.sent.filter((m) => m.type === 'build')).toHaveLength(2)
    expect(worker.transferLengths[worker.sent.findIndex((m) => m.type === 'registerField')]).toBeGreaterThanOrEqual(1)
    worker.pump()
    expect(results).toHaveLength(2)
    const ref = buildTerrainPatchGeometry(field, 0, 1, 0, 1, 8, buildPatchIndex(8), 0.001, detailWrapFor(undefined))
    expect(results[0].arrays.positions).toEqual(ref.geometry.getAttribute('position').array)
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
    const job = (field: TerrainHeightField) => ({ field, face: 0, i: 0, j: 0, level: 1, segments: 8, skirtDepthUnits: 0, wrap: detailWrapFor(undefined) })
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
