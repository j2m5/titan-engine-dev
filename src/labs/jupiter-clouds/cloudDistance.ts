import { cloudShellDistance, cloudVolumeOpacity } from '@/core/clouds/cloudLod'
import { createJupiterCloudProfile } from './jupiterCloudProfile'

const profile = createJupiterCloudProfile()

/** Distances to either boundary of the layer, in metres. */
export interface CloudDistanceRange {
  full: number
  cutoff: number
}

export const DEFAULT_CLOUD_DISTANCE: Readonly<CloudDistanceRange> = {
  full: profile.lod.fullDistanceMeters,
  cutoff: profile.lod.cutoffDistanceMeters
}

export function cloudOpacityAtAltitude(altitude: number, range: CloudDistanceRange = DEFAULT_CLOUD_DISTANCE): number {
  if (!Number.isFinite(range.full) || !Number.isFinite(range.cutoff) || range.full < 0 || range.cutoff <= range.full) {
    throw new Error('Дальность отключения должна быть больше расстояния полного объёма.')
  }
  return cloudVolumeOpacity(cloudShellDistance(altitude, profile.layers), {
    fullDistanceMeters: range.full,
    cutoffDistanceMeters: range.cutoff
  })
}
