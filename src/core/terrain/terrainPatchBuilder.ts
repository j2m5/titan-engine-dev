import type { TerrainHeightField } from './TerrainHeightField'
import type { DetailWrap } from './detailWrap'
import { allocateJobPatchArrays, buildTerrainPatchArrays, type PatchArrays, type PatchBounds } from './terrainPatchGeometry'
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
  /** Раскладка и геоморф: null — пул воды (только positions: ни полосы, ни морфа); true — рельеф, считать родителя; false — рельеф, сдвиг 0. */
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
 * Контракт результата: массивы `PatchBuildResult.arrays` переходят к
 * потребителю — слот подставляет их в атрибуты без копии (applyPatchResult)
 * и отпускает после заливки. Строитель отдаёт свежие массивы на каждое
 * задание и ссылок на них не держит.
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
 * гарантирована. Массивы — свежие на каждое задание (контракт владения).
 */
export class SyncTerrainPatchBuilder implements TerrainPatchBuilder {
  public get offThread(): boolean {
    return false
  }

  public get mapCopies(): number {
    return 1
  }

  public acquire(): void {}

  public request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void, onError: (error: unknown) => void): void {
    const arrays = allocateJobPatchArrays(job.segments, job.morph)
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

  public dispose(): void {}
}
