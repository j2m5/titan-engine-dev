import { Container } from '@/core/framework/container/Container'
import { ServiceProvider } from '@/core/framework/container/ServiceProvider'

type ProviderConstructor = new (app: Container) => ServiceProvider

/**
 * Ядро приложения: владеет единственным контейнером и прогоняет
 * сервис-провайдеры в две фазы:
 *
 *   1. register() у всех провайдеров — наполнение контейнера привязками
 *   2. boot() у всех провайдеров — инициализация, когда все привязки уже на месте
 */
class Kernel {
  private readonly container: Container = new Container()
  private booted: boolean = false
  private instances: ServiceProvider[] | null = null
  private registeredCount: number = 0
  private bootedCount: number = 0

  public constructor(private readonly providers: ProviderConstructor[]) {}

  public bootstrap(): Container {
    if (this.booted) return this.container

    const instances: ServiceProvider[] = this.instances ??= this.providers.map(
      (Provider: ProviderConstructor) => new Provider(this.container)
    )

    // Retry a failed boot with the existing singleton graph. Re-registering
    // completed providers would replace live renderers and their listeners.
    // A provider that throws must itself make its incomplete phase resumable.
    while (this.registeredCount < instances.length) {
      instances[this.registeredCount].register()
      this.registeredCount++
    }
    while (this.bootedCount < instances.length) {
      instances[this.bootedCount].boot()
      this.bootedCount++
    }

    this.booted = true

    return this.container
  }
}

export { Kernel }
