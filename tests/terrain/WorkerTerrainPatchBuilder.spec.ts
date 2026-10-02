import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Texture, type WebGLRenderer } from 'three'
import { WorkerTerrainPatchBuilder, type WorkerLike } from '@/core/terrain/worker/WorkerTerrainPatchBuilder'
import { createWorkerState, handleWorkerMessage } from '@/core/terrain/worker/terrainBuildHandler'
import type { FromWorkerMessage, ToWorkerMessage } from '@/core/terrain/worker/terrainBuildProtocol'
import { SyncTerrainPatchBuilder, type PatchBuildResult, type TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { buildShadowHeightBits, type ShadowHeightBits } from '@/core/terrain/terrainShadowBits'
import { TerrainPatchGroup } from '@/core/terrain/TerrainPatchGroup'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { PatchArrays } from '@/core/terrain/terrainPatchGeometry'
import type { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { buildNearTileHeights } from '@/core/terrain/nearTileBake'
import { expectMatchesFreshBuild, makeField, nearParams, patchJob, snapshotArrays } from './workerBuildHelpers'

/** onError в тестах без сбоя — провал теста, а не тишина. */
const unexpectedError = (error: unknown): never => {
  throw error
}

/** Воркер в том же потоке: сообщения копятся, pump() прогоняет их через настоящий обработчик (переносы не нужны). */
class FakeWorker implements WorkerLike {
  public readonly sent: ToWorkerMessage[] = []
  public readonly transferLengths: number[] = []
  public terminated = false
  public onmessage: ((ev: { data: FromWorkerMessage }) => void) | null = null
  public onerror: ((reason: string) => void) | null = null
  public onmessageerror: ((reason: string) => void) | null = null
  /** Ответы настоящего обработчика, в порядке отправки. */
  public readonly replies: FromWorkerMessage[] = []
  public readonly state = createWorkerState()
  private readonly queue: ToWorkerMessage[] = []

  public postMessage(message: ToWorkerMessage, transfer: Transferable[]): void {
    this.sent.push(message)
    this.transferLengths.push(transfer.length)
    this.queue.push(message)
  }

  public pump(): void {
    for (const message of this.queue.splice(0)) {
      const out = handleWorkerMessage(this.state, message)
      if (!out) continue
      this.replies.push(out.message)
      this.emit(out.message)
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
    builder.request(job, (r) => results.push(r), unexpectedError)
    builder.request(job2, (r) => results.push(r), unexpectedError)
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

  it('флаг morph уходит в build, приход несёт морф-массивы; null — без них', () => {
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const results: PatchBuildResult[] = []
    const jobs = [true, false, null].map((morph) => ({ ...patchJob(field, 0, 1, 0, 0.001, morph), level: 4 }))
    for (const job of jobs) builder.request(job, (r) => results.push(r), unexpectedError)
    expect(worker.sent.filter((m) => m.type === 'build').map((m) => (m as { morph: boolean | null }).morph)).toEqual([
      true,
      false,
      null
    ])
    worker.pump()
    expect(results).toHaveLength(3)
    jobs.forEach((job, k) => expectMatchesFreshBuild(results[k].arrays, job))
    expect(results[2].arrays.morph).toBeNull()
    expect(results[0].arrays.morph!.deltas.some((v) => v !== 0)).toBe(true)
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
    builder.request(job(a), () => calls++, unexpectedError)
    builder.request(job(b), () => calls++, unexpectedError)
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
    builder.request(jobA, (r) => a.push(snapshotArrays(r.arrays)), unexpectedError)
    builder.request(jobB, (r) => b.push(snapshotArrays(r.arrays)), unexpectedError)
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
      builder.request(jobC, (r) => c.push(snapshotArrays(r.arrays)), unexpectedError)
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

  it('карта тени: запрос уходит после регистрации поля, ответ отдаёт биты низкой карты', () => {
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const got: ShadowHeightBits[] = []
    builder.requestShadow(field, (bits) => got.push(bits))
    const types = worker.sent.map((m) => m.type)
    expect(types.indexOf('registerField')).toBeLessThan(types.indexOf('buildShadow'))
    expect(got).toHaveLength(0)
    worker.pump()
    expect(got).toHaveLength(1)
    const expected = buildShadowHeightBits(field.heightMap)
    expect(got[0].width).toBe(expected.width)
    expect(Array.from(got[0].bits)).toEqual(Array.from(expected.bits))
    builder.dispose()
  })

  it('карта тени: отказ воркера строит её на главном потоке, поздний ответ не зовёт onDone второй раз', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const got: ShadowHeightBits[] = []
    builder.requestShadow(field, (bits) => got.push(bits))
    worker.fail('onerror', 'сбой')
    expect(got).toHaveLength(1)
    worker.pump()
    expect(got).toHaveLength(1)
    // после отказа — сразу синхронно
    builder.requestShadow(field, (bits) => got.push(bits))
    expect(got).toHaveLength(2)
    vi.restoreAllMocks()
  })

  it('синхронный строитель отдаёт карту тени внутри запроса', () => {
    const field = makeField()
    const got: ShadowHeightBits[] = []
    new SyncTerrainPatchBuilder().requestShadow(field, (bits) => got.push(bits))
    expect(got).toHaveLength(1)
    expect(Array.from(got[0].bits)).toEqual(Array.from(buildShadowHeightBits(field.heightMap).bits))
  })

  it('плитка ближней тени: запрос после регистрации, ответ воркера — те же числа, что у прямого бейка', () => {
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const params = nearParams([0.3, 0.5, 0.8])
    const got: Float32Array[] = []
    builder.requestNearTile(field, params, (h) => got.push(h), unexpectedError)
    const types = worker.sent.map((m) => m.type)
    expect(types.indexOf('registerField')).toBeLessThan(types.indexOf('buildNearTile'))
    expect(got).toHaveLength(0)
    worker.pump()
    expect(got).toHaveLength(1)
    expect(Array.from(got[0])).toEqual(Array.from(buildNearTileHeights(field, params)))
    builder.dispose()
  })

  it('плитка ближней тени: отказ воркера — реплей на главном потоке, поздний ответ не зовёт onDone второй раз', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const params = nearParams([0.3, 0.5, 0.8])
    const got: Float32Array[] = []
    builder.requestNearTile(field, params, (h) => got.push(h), unexpectedError)
    worker.fail('onerror', 'сбой')
    expect(got).toHaveLength(1)
    worker.pump()
    expect(got).toHaveLength(1)
    builder.requestNearTile(field, params, (h) => got.push(h), unexpectedError)
    expect(got).toHaveLength(2)
    vi.restoreAllMocks()
  })

  it('плитка ближней тени: error-ответ воркера по её requestId — тот же путь отказа, реплей', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const got: Float32Array[] = []
    builder.requestNearTile(field, nearParams([0.3, 0.5, 0.8]), (h) => got.push(h), unexpectedError)
    const sent = worker.sent.find((m) => m.type === 'buildNearTile')!
    worker.emit({ type: 'error', requestId: (sent as { requestId: number }).requestId, message: 'сбой' })
    expect(got).toHaveLength(1)
    vi.restoreAllMocks()
  })

  it('плитка ближней тени: исключение бейка на главном потоке — onError ровно один раз, onDone не зовётся', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const boom = new Error('бейк')
    vi.spyOn(field, 'heightMeters').mockImplementation(() => {
      throw boom
    })
    const errors: unknown[] = []
    const done: Float32Array[] = []
    builder.requestNearTile(field, nearParams([0.3, 0.5, 0.8]), (h) => done.push(h), (e) => errors.push(e))
    worker.fail('onerror', 'сбой')
    expect(errors).toEqual([boom])
    expect(done).toHaveLength(0)
    vi.restoreAllMocks()
  })

  it('синхронный строитель отдаёт плитку внутри запроса, исключение бейка — в onError', () => {
    const field = makeField()
    const params = nearParams([0.3, 0.5, 0.8])
    const got: Float32Array[] = []
    new SyncTerrainPatchBuilder().requestNearTile(field, params, (h) => got.push(h), unexpectedError)
    expect(got).toHaveLength(1)
    expect(Array.from(got[0])).toEqual(Array.from(buildNearTileHeights(field, params)))

    const boom = new Error('бейк')
    vi.spyOn(field, 'heightMeters').mockImplementation(() => {
      throw boom
    })
    const errors: unknown[] = []
    new SyncTerrainPatchBuilder().requestNearTile(field, params, (h) => got.push(h), (e) => errors.push(e))
    expect(errors).toEqual([boom])
    expect(got).toHaveLength(1)
    vi.restoreAllMocks()
  })

  it('built старого воркера после отказа не зовёт onDone второй раз', () => {
    const { worker, a, b } = setup()
    worker.fail('onerror', 'сбой')
    worker.pump() // registerField и оба build ещё в очереди фейка — их built приходят после отказа
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })
})

describe('WorkerTerrainPatchBuilder: исключения на главном потоке', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('исключение при сборке регистрации не оставляет записи: следующий acquire регистрирует поле заново', () => {
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const slice = vi.spyOn(field.heightMap.data, 'slice').mockImplementationOnce(() => {
      throw new RangeError('нет памяти под копию карты')
    })

    expect(() => builder.acquire(field)).toThrow(RangeError)
    expect(worker.sent).toHaveLength(0)

    builder.acquire(field)

    expect(slice).toHaveBeenCalledTimes(2)
    expect(worker.sent.filter((m) => m.type === 'registerField')).toHaveLength(1)

    const results: PatchBuildResult[] = []
    builder.request(patchJob(field, 0, 1, 0), (r) => results.push(r), unexpectedError)
    worker.pump()

    expect(worker.replies.filter((m) => m.type === 'error')).toHaveLength(0)
    expect(results).toHaveLength(1)
  })

  it('исключение в реплее одного задания не теряет остальные: у сломанного onError, у второго onDone', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const broken = makeField()
    const jobA = patchJob(broken, 0, 1, 0)
    const jobB = patchJob(makeField(), 3, 0, 1)
    const a: PatchArrays[] = []
    const b: PatchArrays[] = []
    const aErrors: unknown[] = []
    builder.request(jobA, (r) => a.push(snapshotArrays(r.arrays)), (e) => aErrors.push(e))
    builder.request(jobB, (r) => b.push(snapshotArrays(r.arrays)), unexpectedError)
    vi.spyOn(broken, 'sampleMeters').mockImplementation(() => {
      throw new Error('сбой выборки')
    })

    worker.fail('onerror', 'сбой')

    expect(a).toHaveLength(0)
    expect(aErrors).toHaveLength(1)
    expect(b).toHaveLength(1)
    expectMatchesFreshBuild(b[0], jobB)
    expect(error).not.toHaveBeenCalled()
  })

  it('синхронный строитель: исключение постройки — onError ровно один раз, onDone нет', () => {
    const field = makeField()
    vi.spyOn(field, 'sampleMeters').mockImplementation(() => {
      throw new Error('сбой выборки')
    })
    const done = vi.fn()
    const failed = vi.fn()
    new SyncTerrainPatchBuilder().request(patchJob(field, 0, 0, 0), done, failed)
    expect(done).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledTimes(1)
  })
})

/** Минимальная конкретная группа — как в TerrainPatchGroupAsync.spec. */
class TestPatchGroup extends TerrainPatchGroup {
  public constructor(field: TerrainHeightField, builder: TerrainPatchBuilder) {
    const renderer = { domElement: { height: 1080 } } as unknown as WebGLRenderer
    super(field, new PlanetMaterial(Actor.find(19)!), renderer, undefined, undefined, undefined, undefined, builder)
  }
}

// PlanetMaterial на промахе по ключу рисует плейсхолдер на canvas 2d, которого в jsdom нет
function seedPlaceholderKeys(): void {
  const moonDiffuse = Actor.find(19)!.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string
  for (const name of ['', 'default.png', 'night.jpg', moonDiffuse]) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
}

describe('WorkerTerrainPatchBuilder: releaseField идёт в очереди после уже отправленных build', () => {
  beforeEach(() => seedPlaceholderKeys())

  afterEach(() => {
    resourceStorage.deleteAllTextures()
    vi.restoreAllMocks()
  })

  it('разборка группы при 24 build в очереди: error и отката нет, поле снято; новая группа на том же поле — новый fieldId и ready', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const worker = new FakeWorker()
    const builder = new WorkerTerrainPatchBuilder(worker)
    const field = makeField()
    const builds = (from = 0): number => worker.sent.slice(from).filter((m) => m.type === 'build').length
    const errors = (): number => worker.replies.filter((m) => m.type === 'error').length
    const registeredIds = (): number[] => worker.sent.flatMap((m) => (m.type === 'registerField' ? [m.fieldId] : []))

    const a = new TestPatchGroup(field, builder)
    expect(builds()).toBe(24)
    a.dispose()
    worker.pump()

    expect(errors()).toBe(0)
    expect(warn).not.toHaveBeenCalled()
    expect(worker.state.fields.size).toBe(0)

    const sentBefore = worker.sent.length
    const b = new TestPatchGroup(field, builder)
    // вторая держательница того же поля разобрана до прихода: регистрацию держит ссылка b
    const c = new TestPatchGroup(field, builder)
    c.dispose()

    expect(builds(sentBefore)).toBe(48) // запросы уходят воркеру — отката не было
    expect(registeredIds()).toHaveLength(2)
    expect(registeredIds()[1]).not.toBe(registeredIds()[0])

    worker.pump()

    expect(b.ready).toBe(true)
    expect(errors()).toBe(0)
    expect(warn).not.toHaveBeenCalled()
    expect(worker.state.fields.size).toBe(1)

    b.dispose()
    worker.pump()

    expect(worker.state.fields.size).toBe(0)
  })
})
