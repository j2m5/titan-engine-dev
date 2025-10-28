import 'reflect-metadata'
import { Container } from 'inversify'

abstract class ServiceProvider {
  public container: Container

  public constructor() {
    this.container = new Container()
  }

  public abstract register(): void
}

export { ServiceProvider }
