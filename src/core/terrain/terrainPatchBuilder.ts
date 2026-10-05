import type { TerrainHeightField } from './TerrainHeightField'
import type { DetailWrap } from './detailWrap'
import { allocatePatchArrays, buildTerrainPatchArrays, type PatchArrays, type PatchBounds } from './terrainPatchGeometry'
import { buildNearTileHeights, type NearTileParams } from './nearTileBake'
import { buildShadowHeightBits, type ShadowHeightBits } from './terrainShadowBits'

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
  /** Геоморф: null — у пула нет морф-атрибутов (массивы не выделяются); true — считать родителя; false — сдвиг 0. */
  morph: boolean | null
}

/** Результат сборки: массивы атрибутов, RTC-центр патча и смещения домена детали (тройки — переживают structured clone) и сфера. */
export interface PatchBuildResult {
  arrays: PatchArrays
  center: [number, number, number]
  bounds: PatchBounds
  detailOrigin: [number, number, number]
  detailOrigin2: [number, number, number]
}

/**
 * Строитель патчей: синхронный (тесты, вода, фолбэк без Worker) или
 * воркерный. На запрос ровно один раз зовётся либо `onDone`, либо `onError`
 * (исключение постройки); вызывающий сам решает,
 * нужен ли результат ещё (узел мог выйти из желаемого набора, группа —
 * освободиться).
 *
 * Контракт результата: массивы `PatchBuildResult.arrays` живут только на время
 * `onDone` — потребитель копирует их себе (applyPatchResult) и ссылок не
 * держит. Синхронный строитель отдаёт свой скретч, воркерный — присланные
 * буферы, и переиспользовать их обоим никто не мешает.
 */
export interface TerrainPatchBuilder {
  /** Работа идёт вне главного потока (живой воркер): только такому строителю доверяется тяжёлый бейк плитки ближней тени. */
  readonly offThread: boolean
  /** Сколько резидентных копий карты высот держит строитель вместе с главным потоком: синхронный — 1, живой воркер — 2 (своя копия карты и aux). */
  readonly mapCopies: number
  /** Группа заявляет владение полем (конструктор); парный release — в dispose. Счётчик ссылок у воркерного строителя. */
  acquire(field: TerrainHeightField): void
  request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void, onError: (error: unknown) => void): void
  /** Низкая карта тени по карте поля; onDone ровно один раз, биты — во владение потребителю. */
  requestShadow(field: TerrainHeightField, onDone: (bits: ShadowHeightBits) => void): void
  /** Плитка высот ближней тени; onDone или onError ровно один раз, буфер — во владение потребителю. */
  requestNearTile(
    field: TerrainHeightField,
    params: NearTileParams,
    onDone: (heights: Float32Array) => void,
    onError: (error: unknown) => void
  ): void
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
 * гарантирована. Массивы — два скретча на строителя, без морфа и с морфом
 * (≈140 и ≈263 КиБ при segments=64): результат потребитель копирует внутри onDone (см. контракт
 * интерфейса), аллокация на каждую постройку была бы мусором в горячем пути.
 */
export class SyncTerrainPatchBuilder implements TerrainPatchBuilder {
  private scratch: PatchArrays | null = null
  private scratchMorph: PatchArrays | null = null
  private scratchSegments = -1

  public get offThread(): boolean {
    return false
  }

  public get mapCopies(): number {
    return 1
  }

  public acquire(): void {}

  public request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void, onError: (error: unknown) => void): void {
    const arrays = this.arraysFor(job.segments, job.morph !== null)
    let built: ReturnType<typeof buildTerrainPatchArrays>
    // ловится только постройка: исключение внутри onDone — дефект потребителя, не сбой задания
    try {
      built = buildTerrainPatchArrays(
        job.field,
        job.face,
        job.i,
        job.j,
        job.level,
        job.segments,
        job.skirtDepthUnits,
        job.wrap,
        arrays,
        job.morph === true
      )
    } catch (error) {
      onError(error)
      return
    }
    onDone({
      arrays,
      center: [built.center.x, built.center.y, built.center.z],
      bounds: built.bounds,
      detailOrigin: built.detailOrigin,
      detailOrigin2: built.detailOrigin2
    })
  }

  public requestShadow(field: TerrainHeightField, onDone: (bits: ShadowHeightBits) => void): void {
    onDone(buildShadowHeightBits(field.heightMap))
  }

  public requestNearTile(
    field: TerrainHeightField,
    params: NearTileParams,
    onDone: (heights: Float32Array) => void,
    onError: (error: unknown) => void
  ): void {
    let heights: Float32Array
    // ловится только бейк: исключение внутри onDone — дефект потребителя
    try {
      heights = buildNearTileHeights(field, params)
    } catch (error) {
      onError(error)
      return
    }
    onDone(heights)
  }

  public release(): void {}

  public releaseAll(): void {}

  public dispose(): void {
    this.scratch = null
    this.scratchMorph = null
    this.scratchSegments = -1
  }

  /** Скретч под запрошенный segments и вариант (с морф-массивами или без); пересоздаётся только при смене размера (в проекте он константа). */
  private arraysFor(segments: number, withMorph: boolean): PatchArrays {
    if (this.scratchSegments !== segments) {
      this.scratch = null
      this.scratchMorph = null
      this.scratchSegments = segments
    }
    if (withMorph) {
      this.scratchMorph ??= allocatePatchArrays(segments, true)
      return this.scratchMorph
    }
    this.scratch ??= allocatePatchArrays(segments)

    return this.scratch
  }
}
