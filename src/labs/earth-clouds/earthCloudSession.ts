import type { EarthTextures } from './earthAssets'
export function startEarthCloudSession<T extends { dispose(): void }>(options: {
  load(): Promise<EarthTextures>
  create(textures: EarthTextures): T
  onReady(lab: T): void
  onError(error: Error): void
}): { dispose(): void } {
  let disposed = false
  let lab: T | undefined
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    lab?.dispose()
  }
  void options
    .load()
    .then((textures) => {
      if (disposed) {
        textures.dispose()
        return
      }
      // The constructor owns textures from this call onward, including when it throws.
      lab = options.create(textures)
      if (disposed) {
        lab.dispose()
        return
      }
      options.onReady(lab)
    })
    .catch((error: unknown) => {
      if (disposed) return
      dispose()
      options.onError(error instanceof Error ? error : new Error(String(error)))
    })
  return { dispose }
}
