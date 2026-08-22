import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { forEachSlope } from './slopeMapEncode'

export interface SlopeStatistics { p50: number; p90: number; p99: number; p999: number; max: number }

/** Перцентили модуля уклона карты — та же геометрия арок и базиса, что у энкодера. */
export function slopeStatistics(map: HeightMapData, radiusMeters: number): SlopeStatistics {
  const values = new Float32Array(map.width * map.height)
  let i = 0
  forEachSlope(map, radiusMeters, (_x, _y, e, n) => { values[i++] = Math.hypot(e, n) })
  values.sort()
  const at = (p: number): number => values[Math.min(values.length - 1, Math.floor(p * values.length))]
  return { p50: at(0.5), p90: at(0.9), p99: at(0.99), p999: at(0.999), max: values[values.length - 1] }
}
