import type { EarthFrameRequest, EarthFrameResult } from './earthFrameSchedule'
export interface EarthCloudStateSnapshot {
  volumeState: 'prepared' | 'ready' | 'unavailable'
  volumeMessage: string | null
  resetPending: boolean
}
export class EarthCloudState {
  private status: EarthCloudStateSnapshot = { volumeState: 'prepared', volumeMessage: null, resetPending: true }
  private previousWeight = 0
  invalidate(): void {
    this.status.resetPending = true
    if (this.status.volumeState !== 'unavailable') this.status.volumeState = 'prepared'
  }
  fail(error: Error): void {
    this.status = {
      volumeState: 'unavailable',
      volumeMessage: `Объёмные облака недоступны: ${error.message}`,
      resetPending: true
    }
  }
  begin(requestedWeight: number, cloudsEnabled: boolean): EarthFrameRequest & { resetHistory: boolean } {
    if (!Number.isFinite(requestedWeight) || requestedWeight < 0 || requestedWeight > 1)
      throw new RangeError('Earth cloud weight must be finite and within [0, 1]')
    const weight = cloudsEnabled && this.status.volumeState !== 'unavailable' ? requestedWeight : 0
    if (this.previousWeight === 0 && weight > 0) this.invalidate()
    this.previousWeight = weight
    return { requestedWeight: weight, cloudsEnabled, resetHistory: weight > 0 && this.status.resetPending }
  }
  complete(result: EarthFrameResult): void {
    if (result.volumeError) this.fail(result.volumeError)
    else if (this.status.volumeState !== 'unavailable' && result.volumeUpdated && result.nearRendered) {
      this.status.volumeState = 'ready'
      this.status.resetPending = false
    }
  }
  snapshot(): EarthCloudStateSnapshot {
    return { ...this.status }
  }
}
