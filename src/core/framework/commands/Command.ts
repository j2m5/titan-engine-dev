import { injectable } from 'inversify'

@injectable()
abstract class Command<TArgs extends Record<string, any> = any, TResult = void> {
  protected constructor() {}

  public abstract handle(): Promise<TResult> | TResult

  public static async execute<TArgs extends Record<string, any> = any, TResult = void>(
    this: new (...args: any[]) => Command<TArgs, TResult>,
    args: TArgs
  ): Promise<TResult> {
    const { container } = await import('@/main')

    const instance = container.get<Command<TArgs, TResult>>(this as any)

    Object.assign(instance, args)

    return instance.handle()
  }
}

export { Command }
