import type { Texture } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'

export type CloudSourceStamp = {
  texture: Texture
  image: unknown
  revision: number
  textureVersion: number
  sourceVersion: number
}

const sameStamp = (a: CloudSourceStamp | undefined, b: CloudSourceStamp | undefined): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.texture === b.texture &&
    a.image === b.image &&
    a.revision === b.revision &&
    a.textureVersion === b.textureVersion &&
    a.sourceVersion === b.sourceVersion)

/** Watches borrowed storage entries only. Its owner drops derived bindings in invalidate synchronously. */
export class CloudSources {
  private readonly stamps = new Map<number, CloudSourceStamp | undefined>()
  // Actor resources also contain terrain, night and water maps. Only an actual
  // cloud read (including a missing source) establishes a dependency.
  private readonly dependencies = new Set<string>()
  private readonly paths: ReadonlyMap<number, string>
  private readonly stop: () => void
  private disposed = false

  constructor(
    paths: ReadonlyMap<number, string>,
    private readonly invalidate: () => void
  ) {
    this.paths = new Map(paths)
    this.stop = resourceStorage.subscribeTextureChanges((key) => {
      if (!this.dependencies.has(key)) return
      this.stamps.clear()
      this.invalidate()
    })
  }

  read(resourceId: number): CloudSourceStamp | undefined {
    if (this.disposed) return undefined
    const path = this.paths.get(resourceId)
    if (path === undefined) return undefined
    this.dependencies.add(path)
    const stamp = resourceStorage.getTextureSnapshot(path)
    this.stamps.set(resourceId, stamp)
    return stamp
  }

  poll(): boolean {
    if (this.disposed) return false
    for (const [id, stamp] of this.stamps) {
      if (!sameStamp(stamp, resourceStorage.getTextureSnapshot(this.paths.get(id)!))) {
        this.stamps.clear()
        this.invalidate()
        return true
      }
    }
    return false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.stamps.clear()
    this.dependencies.clear()
  }
}
