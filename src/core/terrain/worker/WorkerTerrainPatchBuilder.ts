import type { TerrainHeightField } from '../TerrainHeightField'
import type { TerrainAuxPayload } from '../terrainAuxFormat'
import type { PatchBuildJob, PatchBuildResult, TerrainPatchBuilder } from '../terrainPatchBuilder'
import type { FromWorkerMessage, ToWorkerMessage } from './terrainBuildProtocol'

/** Минимум Worker, нужный строителю: подменяется фейком в тестах (в jsdom Worker нет). */
export interface WorkerLike {
  postMessage(message: ToWorkerMessage, transfer: Transferable[]): void
  onmessage: ((ev: { data: FromWorkerMessage }) => void) | null
  terminate(): void
}

/**
 * Сообщение регистрации поля: копии тела карты и массивов компаньона, их
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
  const aux = map.aux ? cloneAux(map.aux, transfer) : null

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

/** Все массивы компаньона — виды на один буфер файла: копируется каждый, в transfer — буферы копий. */
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
    terminate: () => worker.terminate()
  }
  worker.onmessage = (ev: MessageEvent<FromWorkerMessage>): void => like.onmessage?.(ev)
  worker.onerror = (ev: ErrorEvent): void => console.error(`[terrain worker] ${ev.message}`)

  return like
}

/**
 * Строитель поверх воркера. Поле регистрируется в воркере при первом acquire
 * или request (копия карты), снимается при нуле ссылок. Сообщения идут FIFO,
 * поэтому регистрация всегда опережает первый build того же поля.
 *
 * request без acquire регистрирует поле с нулём ссылок — такое поле живёт в
 * воркере до releaseAll/dispose. Map, а не WeakMap: releaseAll итерирует.
 *
 * Массивы результата — свежие виды на присланные буферы, контракт
 * «живут только на время onDone» соблюдён с запасом.
 */
export class WorkerTerrainPatchBuilder implements TerrainPatchBuilder {
  private readonly fields = new Map<TerrainHeightField, { id: number; refs: number }>()
  private readonly callbacks = new Map<number, (result: PatchBuildResult) => void>()
  private nextFieldId = 1
  private nextRequestId = 1
  private disposed = false

  public constructor(private readonly worker: WorkerLike = createTerrainBuildWorker()) {
    worker.onmessage = (ev) => this.onMessage(ev.data)
  }

  public acquire(field: TerrainHeightField): void {
    this.ensureField(field).refs++
  }

  public request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void): void {
    const { id } = this.ensureField(job.field)
    const requestId = this.nextRequestId++
    this.callbacks.set(requestId, onDone)
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
    this.callbacks.clear()
    this.fields.clear()
    this.worker.terminate()
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
    if (this.disposed) return

    if (msg.type === 'built') {
      const onDone = this.callbacks.get(msg.requestId)
      if (!onDone) return

      this.callbacks.delete(msg.requestId)
      onDone({
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
      // build не приходит раньше регистрации (FIFO), поэтому ошибка — нарушение инварианта, а не штатный путь
      if (msg.requestId !== null) this.callbacks.delete(msg.requestId)
      console.warn(`[terrain worker] ${msg.message}`)
    }
  }
}
