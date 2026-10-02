import { Vector3 } from 'three'
import type { TerrainHeightField } from './TerrainHeightField'
import { texelCenter, tileToDirInto, type Vec3 } from './terrainNearShadowMath'

/** Параметры плитки ближней тени: тройки, не Vector3 — переживают structured clone. */
export interface NearTileParams {
  /** Центр плитки, единичный, тело-локально. */
  center: Vec3
  east: Vec3
  north: Vec3
  texels: number
  texelMeters: number
}

/**
 * Высоты плитки относительно центра, метры: строка j — y, столбец i — x (0 — юг/запад).
 * Значение heightMeters(tileToDirInto(x, y)) − heightMeters(центр).
 */
export function buildNearTileHeights(field: TerrainHeightField, p: NearTileParams): Float32Array {
  const { center, east, north, texels, texelMeters } = p
  const radiusMeters = field.radiusKm * 1000
  const out = new Float32Array(texels * texels)
  const scratch = new Vector3()
  const d: Vec3 = [0, 0, 0]
  const h0 = field.heightMeters(scratch.set(center[0], center[1], center[2]))

  for (let j = 0; j < texels; j++) {
    const y = texelCenter(j, texels, texelMeters)
    for (let i = 0; i < texels; i++) {
      tileToDirInto(texelCenter(i, texels, texelMeters), y, center, east, north, radiusMeters, d)
      out[j * texels + i] = field.heightMeters(scratch.set(d[0], d[1], d[2])) - h0
    }
  }

  return out
}
