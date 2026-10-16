import type { Color, Object3D } from 'three'
import type { SceneCloudDescriptor } from '@/core/clouds/SceneCloudConfig'
import type { SceneCloudReceiver } from '@/core/clouds/receivers/SceneCloudReceiver'

export interface CloudBodyEntry {
  actorId: number
  object: Object3D
  getSurface(): Object3D | null
  datumRadiusMeters: number
  descriptor: SceneCloudDescriptor
  resourcePaths: ReadonlyMap<number, string>
  lightColor: Color
  lambert: number
}
export class CloudRegistry {
  private readonly bodies = new Map<number, CloudBodyEntry>()
  private readonly bindings = new Map<number, Set<SceneCloudReceiver>>()
  private readonly listeners = new Set<(actorId: number) => void>()
  public subscribe(listener: (actorId: number) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private release(actorId: number): void {
    for (const receiver of this.receivers(actorId)) {
      receiver.setEndpoint(null, null)
      receiver.setFarMap(null, null)
    }
    this.bindings.delete(actorId)
    for (const listener of this.listeners) listener(actorId)
  }
  public bindReceiver(actorId: number, receiver: SceneCloudReceiver): () => void {
    let set = this.bindings.get(actorId)
    if (!set) {
      set = new Set()
      this.bindings.set(actorId, set)
    }
    set.add(receiver)
    return () => {
      receiver.setEndpoint(null, null)
      receiver.setFarMap(null, null)
      set.delete(receiver)
    }
  }
  public receivers(actorId: number): readonly SceneCloudReceiver[] {
    return [...(this.bindings.get(actorId) ?? [])]
  }
  public register(entry: CloudBodyEntry): () => void {
    if (this.bodies.has(entry.actorId)) this.release(entry.actorId)
    this.bodies.set(entry.actorId, entry)
    return () => {
      if (this.bodies.get(entry.actorId) === entry) {
        this.release(entry.actorId)
        this.bodies.delete(entry.actorId)
      }
    }
  }
  public entries(): readonly CloudBodyEntry[] {
    return [...this.bodies.values()]
  }
  public clear(): void {
    for (const id of this.bodies.keys()) this.release(id)
    this.bodies.clear()
  }
}
