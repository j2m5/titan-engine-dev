import type { AtmosphereOverlay, AtmosphereShadow } from '@takram/three-atmosphere'
export interface EarthVolumeFrame {
  overlay: AtmosphereOverlay
  shadow: AtmosphereShadow | null
}
export interface EarthFrameRequest {
  requestedWeight: number
  cloudsEnabled: boolean
}
export interface EarthFrameResult {
  effectiveWeight: number
  farRendered: boolean
  nearRendered: boolean
  volumeUpdated: boolean
  volumeError: Error | null
}
export interface EarthFramePorts {
  updateVolume(): EarthVolumeFrame
  renderFar(showMap: boolean): void
  renderNear(frame: EarthVolumeFrame): void
  clearVolume(): void
  present(weight: number): void
}
export function runEarthFrame(request: EarthFrameRequest, ports: EarthFramePorts): EarthFrameResult {
  if (!Number.isFinite(request.requestedWeight) || request.requestedWeight < 0 || request.requestedWeight > 1)
    throw new RangeError('Earth cloud weight must be finite and within [0, 1]')
  let weight = request.cloudsEnabled ? request.requestedWeight : 0
  let volumeUpdated = false,
    nearRendered = false,
    volumeError: Error | null = null
  if (weight > 0) {
    try {
      const frame = ports.updateVolume()
      volumeUpdated = true
      ports.renderNear(frame)
      nearRendered = true
    } catch (error) {
      volumeError = error instanceof Error ? error : new Error(String(error))
      weight = 0
      ports.clearVolume()
    }
  } else ports.clearVolume()
  const farRendered = weight < 1
  if (farRendered) ports.renderFar(request.cloudsEnabled)
  ports.present(weight)
  return { effectiveWeight: weight, farRendered, nearRendered, volumeUpdated, volumeError }
}
