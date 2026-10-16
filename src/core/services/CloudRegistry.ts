import type { Color, Object3D } from 'three'
import type { SceneCloudDescriptor } from '@/core/clouds/SceneCloudConfig'

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
  public register(entry: CloudBodyEntry): () => void {
    this.bodies.set(entry.actorId, entry)
    return () => {
      if (this.bodies.get(entry.actorId) === entry) this.bodies.delete(entry.actorId)
    }
  }
  public entries(): readonly CloudBodyEntry[] {
    return [...this.bodies.values()]
  }
  public clear(): void {
    this.bodies.clear()
  }
}
