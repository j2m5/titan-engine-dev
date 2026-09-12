import type { TerrainHeightField } from '../TerrainHeightField'
import type { TerrainAuxPayload } from '../terrainAuxFormat'
import { SyncTerrainPatchBuilder, type PatchBuildJob, type PatchBuildResult, type TerrainPatchBuilder } from '../terrainPatchBuilder'
import type { FromWorkerMessage, ToWorkerMessage } from './terrainBuildProtocol'

/** Минимум Worker, нужный строителю: подменяется фейком в тестах (в jsdom Worker нет). */
export interface WorkerLike {
  postMessage(message: ToWorkerMessage, transfer: Transferable[]): void
  onmessage: ((ev: { data: FromWorkerMessage }) => void) | null
  /** Сбой воркера: модуль не загрузился или исключение в обработчике. */
  onerror?: ((reason: string) => void) | null
  /** Ответ воркера не десериализовался. */
  onmessageerror?: ((reason: string) => void) | null
  terminate(): void
}

/**
 * Сообщение регистрации поля: копии тела карты и payload компаньона, их
 * буферы — в transfer. Исходные буферы не переносятся — главный поток
 * продолжает читать поле (коллизия, отбор квадродерева).
 */
export function registerFieldMessage(
  field: TerrainHeightField,
  fieldId: number
): { message: ToWorkerMessage; transfer: ArrayBuffer[] } {
  const map = field.heightMap
  const data = map.data.slice().buffer
  const transfer: ArrayBuffer[] = [data]
  // payload у поля есть всегда (запечённый или посчитанный) — воркер его не пересчитывает
  const aux = cloneAux(field.exportAux(), transfer)

  return {
    message: {
      type: 'registerField',
      fieldId,
      width: map.width,
      height: map.height,
      minMeters: map.minMeters,
      maxMeters: map.maxMeters,
      data,
      aux,
      radiusKm: field.radiusKm,
      midbandParams: field.midbandParams
    },
    transfer
  }
}

/** Массивы компаньона бывают видами на один буфер файла: копируется каждый, в transfer — буферы копий. */
function cloneAux(aux: TerrainAuxPayload, transfer: ArrayBuffer[]): TerrainAuxPayload {
  const levelErrorMeters = aux.levelErrorMeters.slice()
  const clearanceGrid = aux.clearanceGrid.slice()
  const nodeMaxHeightMetersPyramid = aux.nodeMaxHeightMetersPyramid?.slice() ?? null
  const nodeErrorMetersPyramid = aux.nodeErrorMetersPyramid?.slice() ?? null

  transfer.push(levelErrorMeters.buffer, clearanceGrid.buffer)
  if (nodeMaxHeightMetersPyramid) transfer.push(nodeMaxHeightMetersPyramid.buffer)
  if (nodeErrorMetersPyramid) transfer.push(nodeErrorMetersPyramid.buffer)

  return {
    blocksX: aux.blocksX,
    blocksY: aux.blocksY,
    maxClearanceMeters: aux.maxClearanceMeters,
    maxSagMeters: aux.maxSagMeters,
    levelErrorMeters,
    clearanceGrid,
    nodeMaxHeightMetersPyramid,
    nodeErrorMetersPyramid
  }
}

/** Единственное место, где создаётся настоящий Worker (в тестах не зовётся). */
export function createTerrainBuildWorker(): WorkerLike {
  const worker = new Worker(new URL('./terrainBuild.worker.ts', import.meta.url), { type: 'module' })
  const like: WorkerLike = {
    postMessage: (message, transfer) => worker.postMessage(message, transfer),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: () => worker.terminate()
  }
  worker.onmessage = (ev: MessageEvent<FromWorkerMessage>): void => like.onmessage?.(ev)
  // при сбое загрузки модуля приходит голый Event без message
  worker.onerror = (ev: Event): void =>
    like.onerror?.(ev instanceof ErrorEvent && ev.message ? ev.message : 'модуль воркера не загрузился')
  worker.onmessageerror = (): void => like.onmessageerror?.('ответ воркера не десериализован')

  return like
}

type Outstanding = { job: PatchBuildJob; onDone: (result: PatchBuildResult) => void }

/**
 * Строитель поверх воркера. Поле регистрируется в воркере при первом acquire
 * или request (копия карты), снимается при нуле ссылок. Сообщения идут FIFO,
 * поэтому регистрация всегда опережает первый build того же поля.
 *
 * request без acquire регистрирует поле с нулём ссылок — такое поле живёт в
 * воркере до releaseAll/dispose. Map, а не WeakMap: releaseAll итерирует.
 *
 * Отказ воркера (onerror, onmessageerror, error-ответ) необратим: задания в
 * полёте пересобираются синхронным строителем, дальше вся постройка идёт через
 * него, поздние built старого воркера игнорируются. Так «onDone ровно один
 * раз» держится и при сбое — группа не остаётся с вечным pending.
 *
 * Массивы результата — свежие виды на присланные буферы, контракт
 * «живут только на время onDone» соблюдён с запасом.
 */
export class WorkerTerrainPatchBuilder implements TerrainPatchBuilder {
  private readonly fields = new Map<TerrainHeightField, { id: number; refs: number }>()
  private readonly outstanding = new Map<number, Outstanding>()
  private nextFieldId = 1
  private nextRequestId = 1
  private disposed = false
  private fallback: SyncTerrainPatchBuilder | null = null

  public constructor(private readonly worker: WorkerLike = createTerrainBuildWorker()) {
    worker.onmessage = (ev) => this.onMessage(ev.data)
    worker.onerror = (reason) => this.fail(reason)
    worker.onmessageerror = (reason) => this.fail(reason)
  }

  public acquire(field: TerrainHeightField): void {
    if (this.fallback) return

    this.ensureField(field).refs++
  }

  public request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void): void {
    if (this.fallback) {
      this.fallback.request(job, onDone)
      return
    }

    const { id } = this.ensureField(job.field)
    const requestId = this.nextRequestId++
    this.outstanding.set(requestId, { job, onDone })
    this.worker.postMessage(
      {
        type: 'build',
        requestId,
        fieldId: id,
        face: job.face,
        i: job.i,
        j: job.j,
        level: job.level,
        segments: job.segments,
        skirtDepthUnits: job.skirtDepthUnits,
        wrap: job.wrap
      },
      []
    )
  }

  public release(field: TerrainHeightField): void {
    // после отказа fields пуст — выход здесь
    const entry = this.fields.get(field)
    if (!entry) return

    entry.refs--
    if (entry.refs <= 0) {
      this.fields.delete(field)
      this.worker.postMessage({ type: 'releaseField', fieldId: entry.id }, [])
    }
  }

  public releaseAll(): void {
    for (const { id } of this.fields.values()) this.worker.postMessage({ type: 'releaseField', fieldId: id }, [])
    this.fields.clear()
  }

  public dispose(): void {
    this.disposed = true
    this.outstanding.clear()
    this.fields.clear()
    this.worker.terminate()
    this.fallback?.dispose()
  }

  private ensureField(field: TerrainHeightField): { id: number; refs: number } {
    let entry = this.fields.get(field)
    if (!entry) {
      entry = { id: this.nextFieldId++, refs: 0 }
      this.fields.set(field, entry)
      const { message, transfer } = registerFieldMessage(field, entry.id)
      this.worker.postMessage(message, transfer)
    }

    return entry
  }

  private onMessage(msg: FromWorkerMessage): void {
    if (this.disposed || this.fallback) return

    if (msg.type === 'built') {
      const entry = this.outstanding.get(msg.requestId)
      if (!entry) return

      this.outstanding.delete(msg.requestId)
      entry.onDone({
        arrays: {
          positions: new Float32Array(msg.positions),
          detailPos: new Float32Array(msg.detailPos),
          detailPos2: new Float32Array(msg.detailPos2),
          heights: new Float32Array(msg.heights),
          midTilts: new Float32Array(msg.midTilts),
          midShades: new Float32Array(msg.midShades)
        },
        center: msg.center,
        bounds: msg.bounds
      })
    } else if (msg.type === 'error') {
      // штатно не приходит (регистрация раньше build по FIFO) — тот же класс отказа, что onerror
      this.fail(msg.message)
    }
  }

  /** Первый отказ: воркер снимается, задания в полёте пересобираются на главном потоке. */
  private fail(reason: string): void {
    if (this.fallback || this.disposed) return

    console.warn(`[terrain worker] отказ, постройка патчей переходит на главный поток: ${reason}`)
    const fallback = new SyncTerrainPatchBuilder()
    this.fallback = fallback
    this.worker.terminate()
    this.fields.clear()

    // очистка до реплея: onDone может сразу позвать request — тот уйдёт в fallback
    const stranded = [...this.outstanding.values()]
    this.outstanding.clear()
    for (const { job, onDone } of stranded) fallback.request(job, onDone)
  }
}
