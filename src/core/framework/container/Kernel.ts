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

  public constructor(private readonly providers: ProviderConstructor[]) {}

  public bootstrap(): Container {
    if (this.booted) return this.container

    const instances: ServiceProvider[] = this.providers.map(
      (Provider: ProviderConstructor) => new Provider(this.container)
    )

    for (const provider of instances) provider.register()
    for (const provider of instances) provider.boot()

    this.booted = true

    return this.container
  }
}

export { Kernel }
