import type { HeightMapData } from '../heightMapFormat'
import { TerrainHeightField } from '../TerrainHeightField'
import { allocateJobPatchArrays, buildTerrainPatchArrays } from '../terrainPatchGeometry'
import { buildNearTileHeights } from '../nearTileBake'
import { buildShadowHeightBits } from '../terrainShadowBits'
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

    case 'buildShadow': {
      const field = state.fields.get(msg.fieldId)
      if (!field) {
        return {
          message: { type: 'error', requestId: msg.requestId, message: `поле ${msg.fieldId} не зарегистрировано` },
          transfer: []
        }
      }

      const { bits, width, height } = buildShadowHeightBits(field.heightMap)
      const buffer = bits.buffer as ArrayBuffer

      return { message: { type: 'shadowBuilt', requestId: msg.requestId, bits: buffer, width, height }, transfer: [buffer] }
    }

    case 'buildNearTile': {
      const field = state.fields.get(msg.fieldId)
      if (!field) {
        return {
          message: { type: 'error', requestId: msg.requestId, message: `поле ${msg.fieldId} не зарегистрировано` },
          transfer: []
        }
      }

      const buffer = buildNearTileHeights(field, msg.params).buffer as ArrayBuffer

      return { message: { type: 'nearTileBuilt', requestId: msg.requestId, heights: buffer }, transfer: [buffer] }
    }

    case 'build': {
      const field = state.fields.get(msg.fieldId)
      if (!field) {
        return {
          message: { type: 'error', requestId: msg.requestId, message: `поле ${msg.fieldId} не зарегистрировано` },
          transfer: []
        }
      }

      // свежие массивы на каждый патч: их буферы уходят переносом и здесь больше не живут
      const arrays = allocateJobPatchArrays(msg.segments, msg.morph)
      const { center, bounds, detailOrigin, detailOrigin2 } = buildTerrainPatchArrays(
        field,
        msg.face,
        msg.i,
        msg.j,
        msg.level,
        msg.segments,
        msg.skirtDepthUnits,
        msg.wrap,
        arrays,
        msg.morph === true
      )
      const positions = arrays.positions.buffer as ArrayBuffer
      // полоса — только у задания рельефа; у воды (morph null) её нет и по сети не идёт
      const heights = arrays.heights === null ? null : (arrays.heights.buffer as ArrayBuffer)
      const midTilts = arrays.midTilts === null ? null : (arrays.midTilts.buffer as ArrayBuffer)
      const midShades = arrays.midShades === null ? null : (arrays.midShades.buffer as ArrayBuffer)
      const morph =
        arrays.morph === null
          ? null
          : {
              deltas: arrays.morph.deltas.buffer as ArrayBuffer,
              midTilts: arrays.morph.midTilts.buffer as ArrayBuffer,
              midShades: arrays.morph.midShades.buffer as ArrayBuffer
            }

      return {
        message: {
          type: 'built',
          requestId: msg.requestId,
          positions,
          heights,
          midTilts,
          midShades,
          morph,
          center: [center.x, center.y, center.z],
          detailOrigin,
          detailOrigin2,
          bounds
        },
        transfer: [
          positions,
          ...[heights, midTilts, midShades].filter((buffer): buffer is ArrayBuffer => buffer !== null),
          ...(morph === null ? [] : [morph.deltas, morph.midTilts, morph.midShades])
        ]
      }
    }
  }
}
