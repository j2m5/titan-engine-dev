import { describe, it, expect, vi } from 'vitest'
import { Container, ContainerError, token } from '@/core/framework/container/Container'
import { ServiceProvider } from '@/core/framework/container/ServiceProvider'
import { Kernel } from '@/core/framework/container/Kernel'

class Logger {
  public lines: string[] = []
}

class Repository {
  public constructor(public logger: Logger) {}
}

class Service {
  public constructor(public repository: Repository) {}
}

const LoggerToken = token<Logger>('Logger')
const RepositoryToken = token<Repository>('Repository')
const ServiceToken = token<Service>('Service')

describe('Container', () => {
  it('резолвит transient-привязку новым экземпляром при каждом get()', () => {
    const container = new Container()
    container.bind(LoggerToken, () => new Logger())

    expect(container.get(LoggerToken)).not.toBe(container.get(LoggerToken))
  })

  it('резолвит singleton одним и тем же экземпляром', () => {
    const container = new Container()
    container.singleton(LoggerToken, () => new Logger())

    expect(container.get(LoggerToken)).toBe(container.get(LoggerToken))
  })

  it('вызывает фабрику singleton ровно один раз', () => {
    const container = new Container()
    const factory = vi.fn(() => new Logger())
    container.singleton(LoggerToken, factory)

    container.get(LoggerToken)
    container.get(LoggerToken)

    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('instance() возвращает привязанное значение как есть', () => {
    const container = new Container()
    const logger = new Logger()
    container.instance(LoggerToken, logger)

    expect(container.get(LoggerToken)).toBe(logger)
  })

  it('резолвит граф зависимостей через фабрики', () => {
    const container = new Container()
    container.singleton(LoggerToken, () => new Logger())
    container.singleton(RepositoryToken, (c) => new Repository(c.get(LoggerToken)))
    container.singleton(ServiceToken, (c) => new Service(c.get(RepositoryToken)))

    const service = container.get(ServiceToken)

    expect(service).toBeInstanceOf(Service)
    expect(service.repository.logger).toBe(container.get(LoggerToken))
  })

  it('поддерживает конструктор класса как ключ привязки', () => {
    const container = new Container()
    container.bind(Logger, () => new Logger())

    expect(container.get(Logger)).toBeInstanceOf(Logger)
  })

  it('бросает информативную ошибку для незарегистрированной привязки', () => {
    const container = new Container()

    expect(() => container.get(LoggerToken)).toThrow(ContainerError)
    expect(() => container.get(LoggerToken)).toThrow(/Logger/)
  })

  it('ошибка о незарегистрированной привязке содержит цепочку резолва', () => {
    const container = new Container()
    container.singleton(ServiceToken, (c) => new Service(c.get(RepositoryToken)))

    expect(() => container.get(ServiceToken)).toThrow(/Service/)
  })

  it('детектит циклическую зависимость и показывает цикл', () => {
    const A = token<unknown>('A')
    const B = token<unknown>('B')

    const container = new Container()
    container.singleton(A, (c) => ({ b: c.get(B) }))
    container.singleton(B, (c) => ({ a: c.get(A) }))

    expect(() => container.get(A)).toThrow(/Circular dependency/)
    expect(() => container.get(A)).toThrow(/A -> B -> A/)
  })

  it('контейнер остается рабочим после ошибки резолва (стек очищается)', () => {
    const container = new Container()
    container.singleton(RepositoryToken, (c) => new Repository(c.get(LoggerToken)))

    expect(() => container.get(RepositoryToken)).toThrow(ContainerError)

    container.singleton(LoggerToken, () => new Logger())

    expect(container.get(RepositoryToken)).toBeInstanceOf(Repository)
  })

  it('повторная привязка перезаписывает старую вместе с кэшем (подмена в тестах)', () => {
    const container = new Container()
    container.singleton(LoggerToken, () => new Logger())

    const original = container.get(LoggerToken)

    const fake = new Logger()
    container.instance(LoggerToken, fake)

    expect(container.get(LoggerToken)).toBe(fake)
    expect(container.get(LoggerToken)).not.toBe(original)
  })

  it('forget() удаляет привязку, flush() очищает контейнер', () => {
    const container = new Container()
    container.singleton(LoggerToken, () => new Logger())
    container.singleton(RepositoryToken, (c) => new Repository(c.get(LoggerToken)))

    container.forget(LoggerToken)
    expect(container.has(LoggerToken)).toBe(false)
    expect(container.has(RepositoryToken)).toBe(true)

    container.flush()
    expect(container.has(RepositoryToken)).toBe(false)
  })

  it('токены различаются по идентичности, а не по имени', () => {
    const first = token<Logger>('Same')
    const second = token<Logger>('Same')

    const container = new Container()
    container.instance(first, new Logger())

    expect(container.has(first)).toBe(true)
    expect(container.has(second)).toBe(false)
  })
})

describe('Kernel + ServiceProvider', () => {
  it('register() всех провайдеров выполняется до boot() любого из них', () => {
    const order: string[] = []

    class FirstProvider extends ServiceProvider {
      public register(): void {
        order.push('first:register')
        this.app.singleton(LoggerToken, () => new Logger())
      }

      public boot(): void {
        order.push('first:boot')
      }
    }

    class SecondProvider extends ServiceProvider {
      public register(): void {
        order.push('second:register')
      }

      public boot(): void {
        order.push('second:boot')
        // boot() может безопасно резолвить привязку из ДРУГОГО провайдера
        this.app.get(LoggerToken).lines.push('booted')
      }
    }

    const container = new Kernel([FirstProvider, SecondProvider]).bootstrap()

    expect(order).toEqual(['first:register', 'second:register', 'first:boot', 'second:boot'])
    expect(container.get(LoggerToken).lines).toEqual(['booted'])
  })

  it('повторный bootstrap() не выполняет провайдеры заново', () => {
    const register = vi.fn()

    class OnceProvider extends ServiceProvider {
      public register(): void {
        register()
      }
    }

    const kernel = new Kernel([OnceProvider])
    const first = kernel.bootstrap()
    const second = kernel.bootstrap()

    expect(first).toBe(second)
    expect(register).toHaveBeenCalledTimes(1)
  })
})
