import { CLOUD_BASE_METRES, CLOUD_HEIGHT_METRES } from './JupiterCloudAdapter'

/** Distances above the top of the layer, in metres. */
export interface CloudDistanceRange {
  full: number
  cutoff: number
}

export const DEFAULT_CLOUD_DISTANCE: Readonly<CloudDistanceRange> = { full: 100000, cutoff: 1000000 }

export function cloudOpacityAtAltitude(altitude: number, range: CloudDistanceRange = DEFAULT_CLOUD_DISTANCE): number {
  if (!Number.isFinite(range.full) || !Number.isFinite(range.cutoff) || range.full < 0 || range.cutoff <= range.full) {
    throw new Error('Дальность отключения должна быть больше расстояния полного объёма.')
  }
  const distance = Math.max(0, altitude - CLOUD_BASE_METRES - CLOUD_HEIGHT_METRES)
  const t = Math.max(0, Math.min(1, (distance - range.full) / (range.cutoff - range.full)))
  return 1 - t * t * (3 - 2 * t)
}
