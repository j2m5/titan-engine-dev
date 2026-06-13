/**
 * Минималистичный типизированный DI-контейнер.
 *
 * Как это работает:
 * 1. bind/singleton/instance кладут в Map пару "ключ -> фабрика + время жизни".
 * 2. get(key) находит фабрику и вызывает ее, передавая сам контейнер,
 *    чтобы фабрика могла рекурсивно зарезолвить свои зависимости.
 * 3. Для singleton результат первого вызова кэшируется и возвращается всегда.
 */

/**
 * Фантомный тип-маркер. Свойство объявлено через unique symbol и опционально,
 * поэтому в рантайме его не существует — оно живет только в системе типов
 * и заставляет TS различать Token<Engine> и Token<SceneManager>,
 * которые иначе были бы структурно идентичны.
 */
declare const TOKEN_TYPE: unique symbol

export interface Token<T> {
  readonly name: string
  readonly [TOKEN_TYPE]?: T
}

/**
 * Создает уникальный токен привязки.
 *
 * Резолв идет по идентичности объекта (ссылке), а не по имени —
 * минификация кода на это не влияет. Имя нужно только для сообщений об ошибках.
 *
 * @example const EngineToken = token<Engine>('Engine')
 */
export function token<T>(name: string): Token<T> {
  return { name }
}

/**
 * Конструктор класса как ключ привязки.
 * Удобно для transient-классов вроде команд: get(CameraToObjectTransition).
 */
export interface Newable<T> {
  new (...args: any[]): T
}

/** Ключ привязки: токен или конструктор класса */
export type ServiceKey<T> = Token<T> | Newable<T>

/** Фабрика получает контейнер, чтобы резолвить зависимости создаваемого сервиса */
export type Factory<T> = (container: Container) => T

interface Binding<T> {
  factory: Factory<T>
  /** true — singleton: результат фабрики кэшируется */
  shared: boolean
  /** singleton уже создан */
  resolved: boolean
  value?: T
}

class ContainerError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ContainerError'
  }
}

class Container {
  private readonly bindings: Map<ServiceKey<any>, Binding<any>> = new Map()

  /**
   * Стек текущего резолва — для детекции циклических зависимостей
   * и информативных сообщений об ошибках (цепочка "кто кого тянул").
   */
  private readonly stack: ServiceKey<any>[] = []

  /**
   * Transient-привязка: фабрика вызывается при каждом get().
   */
  public bind<T>(key: ServiceKey<T>, factory: Factory<T>): this {
    this.bindings.set(key, { factory, shared: false, resolved: false })

    return this
  }

  /**
   * Singleton-привязка: фабрика вызывается один раз, результат кэшируется.
   * Повторная привязка того же ключа перезаписывает старую (в т.ч. кэш) —
   * это намеренно, чтобы тесты могли подменять реализации.
   */
  public singleton<T>(key: ServiceKey<T>, factory: Factory<T>): this {
    this.bindings.set(key, { factory, shared: true, resolved: false })

    return this
  }

  /**
   * Привязка уже готового значения (аналог $app->instance() в Laravel).
   * Полезно для объектов, создаваемых вне контейнера: threeJS, конфиги и т.п.
   */
  public instance<T>(key: ServiceKey<T>, value: T): this {
    this.bindings.set(key, { factory: () => value, shared: true, resolved: true, value })

    return this
  }

  public has<T>(key: ServiceKey<T>): boolean {
    return this.bindings.has(key)
  }

  /**
   * Резолв сервиса. Тип результата выводится из токена — кастов не требуется.
   *
   * @throws ContainerError если привязка не найдена или обнаружен цикл
   */
  public get<T>(key: ServiceKey<T>): T {
    const binding: Binding<T> | undefined = this.bindings.get(key)

    if (!binding) {
      throw new ContainerError(`Binding "${this.keyName(key)}" is not registered${this.chain()}`)
    }

    if (binding.shared && binding.resolved) {
      return binding.value as T
    }

    if (this.stack.includes(key)) {
      throw new ContainerError(
        `Circular dependency detected: ${[...this.stack, key].map((k) => this.keyName(k)).join(' -> ')}`
      )
    }

    this.stack.push(key)

    try {
      const value: T = binding.factory(this)

      if (binding.shared) {
        binding.value = value
        binding.resolved = true
      }

      return value
    } finally {
      this.stack.pop()
    }
  }

  /**
   * Алиас get()
   */
  public make<T>(key: ServiceKey<T>): T {
    return this.get(key)
  }

  /** Удалить привязку (вместе с кэшем singleton'а) */
  public forget<T>(key: ServiceKey<T>): void {
    this.bindings.delete(key)
  }

  /** Полная очистка контейнера — в основном для тестов */
  public flush(): void {
    this.bindings.clear()
    this.stack.length = 0
  }

  private keyName<T>(key: ServiceKey<T>): string {
    return key.name || '<anonymous>'
  }

  private chain(): string {
    if (this.stack.length === 0) return ''

    return ` (resolution chain: ${this.stack.map((k) => this.keyName(k)).join(' -> ')})`
  }
}

export { Container, ContainerError }
