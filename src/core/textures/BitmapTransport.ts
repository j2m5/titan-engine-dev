import { DefaultLoadingManager, type LoadingManager, type Texture } from 'three'
import { config } from '@/core/framework/config'
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
    const controller = new AbortController()
    let interrupt!: (reason: Error) => void
    const interrupted = new Promise<never>((_resolve, reject) => {
      interrupt = (reason) => {
        controller.abort(reason)
        reject(controller.signal.reason)
      }
    })
    const onAbort = (): void => interrupt(abortError())
    signal?.addEventListener('abort', onAbort, { once: true })
    const timeoutMs = config('streaming.textureTimeoutMs')
    const timer = setTimeout(() => interrupt(new DOMException(
      `Texture request timed out after ${timeoutMs} ms: ${resolved}`, 'TimeoutError'
    )), timeoutMs)
    try {
      if (signal?.aborted) onAbort()
      // createImageBitmap cannot be aborted: settle now and release any late result below.
      return await Promise.race([this.fetchBitmap(resolved, controller.signal, options), interrupted])
    } catch (cause) {
      // Body reads may reject with AbortError even when our deadline triggered the abort.
      const error = controller.signal.aborted ? controller.signal.reason : cause
      if (signal?.aborted || isAbortError(error)) throw abortError()
      this.manager.itemError(resolved)
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      this.manager.itemEnd(resolved)
    }
  }

  private async fetchBitmap(url: string, signal: AbortSignal, options?: ImageBitmapOptions): Promise<ImageBitmap> {
    checkAborted(signal)
    const response = await fetch(url, { signal, credentials: 'same-origin' })
    checkAborted(signal)
    if (!response.ok) throw new Error(`Texture HTTP ${response.status}: ${url}`)
    const blob = await response.blob()
    checkAborted(signal)
    const bitmap = await createImageBitmap(blob, options)
    if (signal.aborted) {
      bitmap.close()
      throw abortError()
    }
    return bitmap
  }
}

const gpuOnlyDisposals = new WeakSet<Texture>()

/** Retire Three's GPU allocation while retaining sources for context restoration. */
export function disposeTextureGpuAllocation(texture: Texture): void {
  gpuOnlyDisposals.add(texture)
  try {
    texture.dispose()
  } finally {
    gpuOnlyDisposals.delete(texture)
  }
}

/** Sources stay open for context restoration. Ordinary disposal is the final release. */
export function ownBitmaps(texture: Texture, bitmaps: readonly ImageBitmap[]): void {
  const release = (): void => {
    if (gpuOnlyDisposals.has(texture)) return
    texture.removeEventListener('dispose', release)
    for (const bitmap of new Set(bitmaps)) bitmap.close()
  }
  texture.addEventListener('dispose', release)
}
