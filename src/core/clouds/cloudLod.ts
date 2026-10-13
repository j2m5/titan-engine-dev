import type { CloudLayerConfig, EnabledCloudConfig } from './CloudConfig'

export function cloudShellDistance(
  altitudeMeters: number,
  layers: readonly Pick<CloudLayerConfig, 'baseAltitudeMeters' | 'thicknessMeters'>[]
): number {
  if (!Number.isFinite(altitudeMeters) || !Array.isArray(layers) || layers.length === 0) {
    throw new RangeError('Finite altitude and nonempty shells required')
  }
  let distance = Infinity
  for (const layer of layers) {
    if (
      !layer ||
      !Number.isFinite(layer.baseAltitudeMeters) ||
      layer.baseAltitudeMeters < 0 ||
      !Number.isFinite(layer.thicknessMeters) ||
      layer.thicknessMeters <= 0 ||
      !Number.isFinite(layer.baseAltitudeMeters + layer.thicknessMeters)
    ) {
      throw new RangeError('Invalid cloud shell dimensions')
    }
    distance = Math.min(
      distance,
      Math.max(
        layer.baseAltitudeMeters - altitudeMeters,
        altitudeMeters - layer.baseAltitudeMeters - layer.thicknessMeters,
        0
      )
    )
  }
  return distance
}

export function cloudVolumeOpacity(distanceMeters: number, lod: EnabledCloudConfig['lod']): number {
  if (
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    !lod ||
    !Number.isFinite(lod.fullDistanceMeters) ||
    lod.fullDistanceMeters < 0 ||
    !Number.isFinite(lod.cutoffDistanceMeters) ||
    lod.cutoffDistanceMeters <= lod.fullDistanceMeters
  ) {
    throw new RangeError('Invalid cloud distance or LOD range')
  }
  const t = Math.max(
    0,
    Math.min(1, (distanceMeters - lod.fullDistanceMeters) / (lod.cutoffDistanceMeters - lod.fullDistanceMeters))
  )
  return 1 - t * t * (3 - 2 * t)
}
