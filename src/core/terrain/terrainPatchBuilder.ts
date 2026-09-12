import type { TerrainHeightField } from './TerrainHeightField'
import type { DetailWrap } from './detailWrap'
import { allocatePatchArrays, buildTerrainPatchArrays, type PatchArrays, type PatchBounds } from './terrainPatchGeometry'

/** Задание на сборку одного патча — всё, что нужно ядру мешера (см. buildTerrainPatchArrays). */
export interface PatchBuildJob {
  field: TerrainHeightField
  face: number
  i: number
  j: number
  level: number
  segments: number
  skirtDepthUnits: number
  wrap: DetailWrap
}

/** Результат сборки: массивы атрибутов, RTC-центр патча (тройка, не Vector3 — переживает structured clone) и сфера. */
export interface PatchBuildResult {
  arrays: PatchArrays
  center: [number, number, number]
  bounds: PatchBounds
}

/**
 * Строитель патчей: синхронный (тесты, вода, фолбэк без Worker) или
 * воркерный. `onDone` зовётся ровно один раз на запрос; вызывающий сам решает,
 * нужен ли результат ещё (узел мог выйти из желаемого набора, группа —
 * освободиться).
 *
 * Контракт результата: массивы `PatchBuildResult.arrays` живут только на время
 * `onDone` — потребитель копирует их себе (applyPatchResult) и ссылок не
 * держит. Синхронный строитель отдаёт свой скретч, воркерный — присланные
 * буферы, и переиспользовать их обоим никто не мешает.
 */
export interface TerrainPatchBuilder {
  /** Группа заявляет владение полем (конструктор); парный release — в dispose. Счётчик ссылок у воркерного строителя. */
  acquire(field: TerrainHeightField): void
  request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void): void
  release(field: TerrainHeightField): void
  /**
   * Снимает все регистрации полей. Звать только после разборки всех групп:
   * запоздалый release после releaseAll отпустил бы новую регистрацию того же поля.
   */
  releaseAll(): void
  dispose(): void
}

/**
 * Постройка на месте: onDone внутри request, поэтому одна постройка за кадр
 * гарантирована. Массивы — один скретч на строителя (≈245 КиБ при
 * segments=64): результат потребитель копирует внутри onDone (см. контракт
 * интерфейса), аллокация на каждую постройку была бы мусором в горячем пути.
 */
export class SyncTerrainPatchBuilder implements TerrainPatchBuilder {
  private scratch: PatchArrays | null = null
  private scratchSegments = -1

  public acquire(): void {}

  public request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void): void {
    const arrays = this.arraysFor(job.segments)
    const { center, bounds } = buildTerrainPatchArrays(
      job.field,
      job.face,
      job.i,
      job.j,
      job.level,
      job.segments,
      job.skirtDepthUnits,
      job.wrap,
      arrays
    )
    onDone({ arrays, center: [center.x, center.y, center.z], bounds })
  }

  public release(): void {}

  public releaseAll(): void {}

  public dispose(): void {
    this.scratch = null
    this.scratchSegments = -1
  }

  /** Скретч под запрошенный segments; пересоздаётся только при смене размера (в проекте он константа). */
  private arraysFor(segments: number): PatchArrays {
    if (this.scratch === null || this.scratchSegments !== segments) {
      this.scratch = allocatePatchArrays(segments)
      this.scratchSegments = segments
    }

    return this.scratch
  }
}
