import type { DetailWrap } from '../detailWrap'
import type { MidbandParams } from '../midbandParams'
import type { TerrainAuxPayload } from '../terrainAuxFormat'
import type { PatchBounds } from '../terrainPatchGeometry'

/**
 * Протокол воркера постройки патчей. Всё в сообщениях переживает structured
 * clone: карта и компаньон — копии главного потока (буферы в transfer),
 * результат — свежие буферы воркера (тоже в transfer). Ответы идут в порядке
 * запросов: регистрация поля всегда раньше первого build того же поля.
 */
export type ToWorkerMessage =
  | {
      type: 'registerField'
      fieldId: number
      width: number
      height: number
      minMeters: number
      maxMeters: number
      /** Тело карты Uint16. */
      data: ArrayBuffer
      /** Payload компаньона главного поля (запечённый или посчитанный) — воркер не пересчитывает. */
      aux: TerrainAuxPayload
      radiusKm: number
      midbandParams: MidbandParams
    }
  | { type: 'releaseField'; fieldId: number }
  | {
      type: 'build'
      requestId: number
      fieldId: number
      face: number
      i: number
      j: number
      level: number
      segments: number
      skirtDepthUnits: number
      wrap: DetailWrap
    }

export type FromWorkerMessage =
  | {
      type: 'built'
      requestId: number
      /** Буферы PatchArrays (Float32), раскладка как у allocatePatchArrays. */
      positions: ArrayBuffer
      detailPos: ArrayBuffer
      detailPos2: ArrayBuffer
      heights: ArrayBuffer
      midTilts: ArrayBuffer
      midShades: ArrayBuffer
      center: [number, number, number]
      bounds: PatchBounds
    }
  | { type: 'fieldReady'; fieldId: number }
  | { type: 'error'; requestId: number | null; message: string }
