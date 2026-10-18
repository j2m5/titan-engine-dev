import { expect, it } from 'vitest'
import { token } from '@/core/framework/container/Container'
import { Kernel } from '@/core/framework/container/Kernel'
import { ServiceProvider } from '@/core/framework/container/ServiceProvider'

it('resumes failed boot with the existing singleton and completed provider boots', () => {
  const resource = token<{ listenerCount: number }>('session renderer')
  let created = 0
  let fail = true
  let firstResource: { listenerCount: number } | undefined
  class SessionProvider extends ServiceProvider {
    public register(): void {
      this.app.singleton(resource, () => { created++; return { listenerCount: 0 } })
    }
    public boot(): void {
      const renderer = this.app.get(resource)
      renderer.listenerCount++
      firstResource = renderer
    }
  }
  class LaterProvider extends ServiceProvider {
    public register(): void {}
    public boot(): void {
      this.app.get(resource)
      if (fail) { fail = false; throw new Error('temporary initialization failure') }
    }
  }
  const kernel = new Kernel([SessionProvider, LaterProvider])
  expect(() => kernel.bootstrap()).toThrow('temporary initialization failure')
  const container = kernel.bootstrap()
  expect(created).toBe(1)
  expect(container.get(resource)).toBe(firstResource)
  expect(container.get(resource).listenerCount).toBe(1)
  expect(kernel.bootstrap()).toBe(container)
})
