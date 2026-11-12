import { LoadingManager, Scene, WebGLRenderer } from 'three'
import { streaming } from '@/config/streaming'
import { Scenarios } from '@/config/scenarios'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'
import { TextureProvider } from '@/core/textures/TextureProvider'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { TextureBudget } from '@/core/streaming/TextureBudget'
import type { SceneObserver } from '@/core/services/SceneObserver'

/** The runner sends HTTP 200 headers but never finishes the image response. */
export async function checkTextureTimeout(url: string): Promise<{
  total: number; progress: number; notifications: string[]; managerErrors: number; managerCompletions: number
}> {
  if (resourceStorage.getCountTextures() !== 0) throw new Error('Timeout probe requires empty resource storage')
  const originalTimeout = streaming.streaming.textureTimeoutMs
  streaming.streaming.textureTimeoutMs = 1000
  const renderer = new WebGLRenderer()
  const manager = new LoadingManager()
  manager.setURLModifier(() => url)
  let managerErrors = 0, managerCompletions = 0, total = 0, progress = 0
  manager.onError = () => { managerErrors++ }
  manager.onLoad = () => { managerCompletions++ }
  const notifications: string[] = []
  const observer = new ResourceObserver(
    { subscribe() {} } as unknown as SceneObserver,
    new TextureProvider(renderer, [ImageBitmapStrategy.create(manager)]),
    { setAsset() {}, setTotal(value) { total = value }, setProgress(value) { progress = value } },
    { dispatch(notification) { notifications.push(notification.message) } },
    new Scene(), new TextureBudget(1024 ** 3)
  )
  observer.scenario = Scenarios[0]
  observer.cube = []
  observer.resident = [{ id: -1, path: 'held.png', resourceType: 'diffuse', lifecycle: 'resident' }]
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      observer.loadPrimaryTextures(),
      new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(() => reject(new Error('Primary texture loading remained pending past its deadline')), 5000)
      })
    ])
    if (total !== 1 || progress !== 1 || resourceStorage.getCountTextures() !== 0) {
      throw new Error(`Timeout left incorrect loading state: ${JSON.stringify({ total, progress })}`)
    }
    if (notifications.length !== 1 || !notifications[0].includes('timed out')) {
      throw new Error(`Timeout was not reported as a genuine load failure: ${JSON.stringify(notifications)}`)
    }
    if (managerErrors !== 1 || managerCompletions !== 1) throw new Error('Unbalanced timeout loading-manager accounting')
    return { total, progress, notifications, managerErrors, managerCompletions }
  } finally {
    clearTimeout(watchdog)
    observer.scenario = null
    streaming.streaming.textureTimeoutMs = originalTimeout
    renderer.dispose()
  }
}
