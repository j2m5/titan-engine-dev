import { Container } from '@/core/framework/container/Container'

abstract class ServiceProvider {
  public constructor(protected readonly app: Container) {}

  public abstract register(): void

  public boot(): void {
    //
  }
}

export { ServiceProvider }
