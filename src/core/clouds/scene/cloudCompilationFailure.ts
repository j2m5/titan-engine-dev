import type { WebGLRenderer } from 'three'
import type { SceneCloudReceiver } from '../receivers/SceneCloudReceiver'

export interface CloudCompilationEvidence {
  stage: 'setup' | 'depth' | 'backend' | 'near'
  recovery: 'context' | 'owned-near'
  receivers?: readonly SceneCloudReceiver[]
}
interface Failure extends CloudCompilationEvidence {
  cause: unknown
  boundary: string
}
const contextFailures = new WeakMap<WebGLRenderer, Failure>()

/** Failure evidence outlives preparation, selection, scenarios and same-renderer runtime reconstruction. */
export class CloudCompilationFailures {
  private renderer: WebGLRenderer | null = null
  private failure: Failure | null = null
  private sawLoss = false
  public bind(renderer: WebGLRenderer): void {
    if (this.renderer && this.renderer !== renderer) this.failure = null
    this.renderer = renderer
    if (this.failure?.recovery === 'context') contextFailures.set(renderer, this.failure)
  }
  public get current(): Failure | null {
    return (this.renderer && contextFailures.get(this.renderer)) || this.failure
  }
  public record(cause: unknown, evidence: CloudCompilationEvidence, boundary: string): void {
    const previous = this.current
    if (previous?.recovery === 'context') return
    const receivers = [...new Set([...(previous?.receivers ?? []), ...(evidence.receivers ?? [])])]
    const recovery =
      evidence.recovery === 'owned-near' && evidence.stage === 'near' && receivers.length ? 'owned-near' : 'context'
    this.failure = {
      ...evidence,
      recovery,
      receivers: recovery === 'owned-near' ? receivers : undefined,
      cause: previous?.cause ?? cause,
      boundary: previous?.boundary ?? boundary
    }
    if (recovery === 'context' && this.renderer) contextFailures.set(this.renderer, this.failure)
  }
  public retry(boundary: string, liveReceivers: readonly SceneCloudReceiver[]): boolean {
    const failure = this.current
    if (!failure) return true
    if (failure.recovery === 'context' || failure.boundary === boundary) return false
    const live = new Set(liveReceivers)
    if (failure.receivers?.some((receiver) => !live.has(receiver))) {
      this.record(failure.cause, { stage: failure.stage, recovery: 'context' }, boundary)
      return false
    }
    try {
      for (const receiver of failure.receivers ?? []) receiver.retryEndpointMaterial()
    } catch {
      this.record(failure.cause, { stage: failure.stage, recovery: 'context' }, boundary)
      return false
    }
    this.failure = null
    return true
  }
  public lost(): void {
    this.sawLoss = true
  }
  public restored(): void {
    if (!this.sawLoss) return
    this.sawLoss = false
    this.failure = null
    if (this.renderer) contextFailures.delete(this.renderer)
  }
  public dispose(): void {
    const failure = this.current
    if (failure?.recovery === 'owned-near')
      this.record(failure.cause, { stage: failure.stage, recovery: 'context' }, failure.boundary)
  }
}
