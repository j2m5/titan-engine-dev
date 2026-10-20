import { DefaultLoadingManager, type LoadingManager, type Texture } from 'three'
import { abortError, checkAborted, isAbortError } from '@/core/textures/cancellation'

export interface BitmapLoader {
  loadAsync(url: string, signal?: AbortSignal, options?: ImageBitmapOptions): Promise<ImageBitmap>
}

/** Request-local transport: a shared Three loader's abort() cancels unrelated files. */
export class BitmapTransport implements BitmapLoader {
  public constructor(private readonly manager: LoadingManager = DefaultLoadingManager) {}

  public async loadAsync(url: string, signal?: AbortSignal, options?: ImageBitmapOptions): Promise<ImageBitmap> {
    checkAborted(signal)
    const resolved = this.manager.resolveURL(url)
    this.manager.itemStart(resolved)
    try {
      const response = await fetch(resolved, { signal, credentials: 'same-origin' })
      checkAborted(signal)
      if (!response.ok) throw new Error(`Texture HTTP ${response.status}: ${resolved}`)
      const blob = await response.blob()
      checkAborted(signal)
      const bitmap = await createImageBitmap(blob, options)
      if (signal?.aborted) {
        bitmap.close()
        throw abortError()
      }
      return bitmap
    } catch (cause) {
      if (signal?.aborted || isAbortError(cause)) throw abortError()
      this.manager.itemError(resolved)
      throw cause
    } finally {
      this.manager.itemEnd(resolved)
    }
  }
}

/** Sources stay open for context restoration. Texture disposal is the final release. */
export function ownBitmaps(texture: Texture, bitmaps: readonly ImageBitmap[]): void {
  const release = (): void => {
    texture.removeEventListener('dispose', release)
    for (const bitmap of new Set(bitmaps)) bitmap.close()
  }
  texture.addEventListener('dispose', release)
}
