import { Container, Newable } from '@/core/framework/container/Container'

/**
 * Базовый класс команды.
 * Это единственное место за пределами composition root, которое держит ссылку
 * на контейнер, и это осознанный компромисс: статический Command.execute()
 * по определению не может получить зависимости через конструктор.
 */
abstract class Command<TArgs extends Record<string, any> = any, TResult = void> {
  private static container: Container | null = null

  protected constructor() {}

  public abstract handle(): Promise<TResult> | TResult

  /** Вызывается один раз при бутстрапе приложения */
  public static useContainer(container: Container): void {
    Command.container = container
  }

  public static async execute<TArgs extends Record<string, any> = any, TResult = void>(
    this: Newable<Command<TArgs, TResult>>,
    args: TArgs
  ): Promise<TResult> {
    if (!Command.container) {
      throw new Error('Command container is not set. Call Command.useContainer() during bootstrap.')
    }

    const instance: Command<TArgs, TResult> = Command.container.get(this)

    Object.assign(instance, args)

    return instance.handle()
  }
}

export { Command }
