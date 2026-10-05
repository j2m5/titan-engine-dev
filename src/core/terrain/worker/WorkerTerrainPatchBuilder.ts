import type { TerrainHeightField } from '../TerrainHeightField'
import type { NearTileParams } from '../nearTileBake'
import type { TerrainAuxPayload } from '../terrainAuxFormat'
import { SyncTerrainPatchBuilder, type PatchBuildJob, type PatchBuildResult, type TerrainPatchBuilder } from '../terrainPatchBuilder'
import type { ShadowHeightBits } from '../terrainShadowBits'
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

type Outstanding = {
  job: PatchBuildJob
  onDone: (result: PatchBuildResult) => void
  onError: (error: unknown) => void
}
type OutstandingShadow = { field: TerrainHeightField; onDone: (bits: ShadowHeightBits) => void }
type OutstandingNearTile = {
  field: TerrainHeightField
  params: NearTileParams
  onDone: (heights: Float32Array) => void
  onError: (error: unknown) => void
}

/**
 * Строитель поверх воркера. Поле регистрируется в воркере при первом acquire
 * или request (копия карты), снимается при нуле ссылок. Сообщения идут FIFO,
 * поэтому регистрация всегда опережает первый build того же поля.
 *
 * request без acquire регистрирует поле с нулём ссылок — такое поле живёт в
 * воркере до releaseAll/dispose. Map, а не WeakMap: releaseAll итерирует.
 *
 * Отказ воркера (onerror, onmessageerror, error-ответ) необратим: задания в
 * полёте (кроме плиток ближней тени — те получают onError) пересобираются синхронным строителем, дальше вся постройка идёт через
 * него, поздние built старого воркера игнорируются. Так «onDone ровно один
 * раз» держится и при сбое — группа не остаётся с вечным pending.
 *
 * Массивы результата — свежие виды на присланные из воркера (переданные, а не
 * скопированные) буферы: на каждое задание свои, ссылок на них строитель не
 * держит. Контракт тот же, что у TerrainPatchBuilder: массивы переходят к
 * потребителю (слот пула подставляет их в атрибуты без копии и отпускает после
 * заливки), а не живут только на время onDone.
 */
export class WorkerTerrainPatchBuilder implements TerrainPatchBuilder {
  private readonly fields = new Map<TerrainHeightField, { id: number; refs: number }>()
  private readonly outstanding = new Map<number, Outstanding>()
  private readonly outstandingShadows = new Map<number, OutstandingShadow>()
  private readonly outstandingNearTiles = new Map<number, OutstandingNearTile>()
  private nextFieldId = 1
  private nextRequestId = 1
  private disposed = false
  private fallback: SyncTerrainPatchBuilder | null = null

  public constructor(private readonly worker: WorkerLike = createTerrainBuildWorker()) {
    worker.onmessage = (ev) => this.onMessage(ev.data)
    worker.onerror = (reason) => this.fail(reason)
    worker.onmessageerror = (reason) => this.fail(reason)
  }

  public get offThread(): boolean {
    return this.fallback === null && !this.disposed
  }

  public get mapCopies(): number {
    return this.offThread ? 2 : 1
  }

  public acquire(field: TerrainHeightField): void {
    if (this.fallback) return

    this.ensureField(field).refs++
  }

  public request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void, onError: (error: unknown) => void): void {
    if (this.fallback) {
      this.fallback.request(job, onDone, onError)
      return
    }

    const { id } = this.ensureField(job.field)
    const requestId = this.nextRequestId++
    this.outstanding.set(requestId, { job, onDone, onError })
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
        wrap: job.wrap,
        morph: job.morph
      },
      []
    )
  }

  /** Карта тени строится из копии карты, уже лежащей в воркере: главный поток не платит ни счётом, ни копией. */
  public requestShadow(field: TerrainHeightField, onDone: (bits: ShadowHeightBits) => void): void {
    if (this.fallback) {
      this.fallback.requestShadow(field, onDone)
      return
    }

    const { id } = this.ensureField(field)
    const requestId = this.nextRequestId++
    this.outstandingShadows.set(requestId, { field, onDone })
    this.worker.postMessage({ type: 'buildShadow', requestId, fieldId: id }, [])
  }

  /** Плитка ближней тени бейкается в воркере из копии карты; без воркера — onError (синхронный бейк 512² фризит кадр). */
  public requestNearTile(
    field: TerrainHeightField,
    params: NearTileParams,
    onDone: (heights: Float32Array) => void,
    onError: (error: unknown) => void
  ): void {
    if (this.fallback) {
      onError(new Error('воркер отказал: плитка ближней тени без воркера не строится'))
      return
    }

    const { id } = this.ensureField(field)
    const requestId = this.nextRequestId++
    this.outstandingNearTiles.set(requestId, { field, params, onDone, onError })
    this.worker.postMessage({ type: 'buildNearTile', requestId, fieldId: id, params }, [])
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

  /**
   * Звать только после разборки всех групп: запоздалый release после
   * releaseAll отпустил бы новую регистрацию того же поля.
   */
  public releaseAll(): void {
    for (const { id } of this.fields.values()) this.worker.postMessage({ type: 'releaseField', fieldId: id }, [])
    this.fields.clear()
  }

  public dispose(): void {
    this.disposed = true
    this.outstanding.clear()
    this.outstandingShadows.clear()
    this.outstandingNearTiles.clear()
    this.fields.clear()
    this.worker.terminate()
    this.fallback?.dispose()
  }

  private ensureField(field: TerrainHeightField): { id: number; refs: number } {
    let entry = this.fields.get(field)
    if (!entry) {
      // запись — только после отправки: исключение сборки сообщения (копия карты) не оставляет фантома
      const id = this.nextFieldId++
      const { message, transfer } = registerFieldMessage(field, id)
      this.worker.postMessage(message, transfer)
      entry = { id, refs: 0 }
      this.fields.set(field, entry)
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
          heights: msg.heights === null ? null : new Float32Array(msg.heights),
          midTilts: msg.midTilts === null ? null : new Float32Array(msg.midTilts),
          midShades: msg.midShades === null ? null : new Float32Array(msg.midShades),
          morph:
            msg.morph === null
              ? null
              : {
                  deltas: new Float32Array(msg.morph.deltas),
                  midTilts: new Float32Array(msg.morph.midTilts),
                  midShades: new Float32Array(msg.morph.midShades)
                }
        },
        center: msg.center,
        bounds: msg.bounds,
        detailOrigin: msg.detailOrigin,
        detailOrigin2: msg.detailOrigin2
      })
    } else if (msg.type === 'shadowBuilt') {
      const entry = this.outstandingShadows.get(msg.requestId)
      if (!entry) return

      this.outstandingShadows.delete(msg.requestId)
      entry.onDone({ bits: new Uint16Array(msg.bits), width: msg.width, height: msg.height })
    } else if (msg.type === 'nearTileBuilt') {
      const entry = this.outstandingNearTiles.get(msg.requestId)
      if (!entry) return

      this.outstandingNearTiles.delete(msg.requestId)
      entry.onDone(new Float32Array(msg.heights))
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
    for (const { job, onDone, onError } of stranded) {
      // сбой постройки строитель отдаёт в onError; здесь ловится только исключение потребителя
      try {
        fallback.request(job, onDone, onError)
      } catch (error) {
        console.error('[terrain worker] обработчик пересобранного задания упал:', error)
      }
    }

    const strandedShadows = [...this.outstandingShadows.values()]
    this.outstandingShadows.clear()
    for (const { field, onDone } of strandedShadows) {
      try {
        fallback.requestShadow(field, onDone)
      } catch (error) {
        console.error('[terrain worker] синхронная постройка карты тени упала:', error)
      }
    }

    // плитки не переигрываются: синхронный бейк 512² — фриз главного потока
    const strandedTiles = [...this.outstandingNearTiles.values()]
    this.outstandingNearTiles.clear()
    for (const { onError } of strandedTiles) {
      try {
        onError(new Error('воркер отказал: плитка ближней тени не построена'))
      } catch (error) {
        console.error('[terrain worker] обработчик отказа плитки упал:', error)
      }
    }
  }
}
