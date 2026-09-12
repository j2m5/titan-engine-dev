import type { HeightMapData } from '../heightMapFormat'
import { TerrainHeightField } from '../TerrainHeightField'
import { allocatePatchArrays, buildTerrainPatchArrays } from '../terrainPatchGeometry'
import type { FromWorkerMessage, ToWorkerMessage } from './terrainBuildProtocol'

/** Состояние воркера: поля высот по fieldId главного потока. */
export interface WorkerState {
  fields: Map<number, TerrainHeightField>
}

export function createWorkerState(): WorkerState {
  return { fields: new Map() }
}

/**
 * Чистый обработчик одного сообщения — вся логика воркера; оболочка только
 * пересылает. null — ответа нет. Build по незарегистрированному полю отвечает
 * error, а не исключением.
 */
export function handleWorkerMessage(
  state: WorkerState,
  msg: ToWorkerMessage
): { message: FromWorkerMessage; transfer: ArrayBuffer[] } | null {
  switch (msg.type) {
    case 'registerField': {
      const map: HeightMapData = {
        width: msg.width,
        height: msg.height,
        minMeters: msg.minMeters,
        maxMeters: msg.maxMeters,
        data: new Uint16Array(msg.data),
        aux: msg.aux
      }
      state.fields.set(msg.fieldId, new TerrainHeightField(map, msg.radiusKm, msg.midbandParams))
      return { message: { type: 'fieldReady', fieldId: msg.fieldId }, transfer: [] }
    }

    case 'releaseField':
      state.fields.delete(msg.fieldId)
      return null

    case 'build': {
      const field = state.fields.get(msg.fieldId)
      if (!field) {
        return {
          message: { type: 'error', requestId: msg.requestId, message: `поле ${msg.fieldId} не зарегистрировано` },
          transfer: []
        }
      }

      // свежие массивы на каждый патч: их буферы уходят переносом и здесь больше не живут
      const arrays = allocatePatchArrays(msg.segments)
      const { center, bounds } = buildTerrainPatchArrays(
        field,
        msg.face,
        msg.i,
        msg.j,
        msg.level,
        msg.segments,
        msg.skirtDepthUnits,
        msg.wrap,
        arrays
      )
      const positions = arrays.positions.buffer as ArrayBuffer
      const detailPos = arrays.detailPos.buffer as ArrayBuffer
      const detailPos2 = arrays.detailPos2.buffer as ArrayBuffer
      const heights = arrays.heights.buffer as ArrayBuffer
      const midTilts = arrays.midTilts.buffer as ArrayBuffer
      const midShades = arrays.midShades.buffer as ArrayBuffer

      return {
        message: {
          type: 'built',
          requestId: msg.requestId,
          positions,
          detailPos,
          detailPos2,
          heights,
          midTilts,
          midShades,
          center: [center.x, center.y, center.z],
          bounds
        },
        transfer: [positions, detailPos, detailPos2, heights, midTilts, midShades]
      }
    }
  }
}
