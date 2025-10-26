abstract class Command<TArgs extends Record<string, any> = any, TResult = void> {
  public constructor(args: TArgs) {
    Object.assign(this, args)
  }

  public abstract handle(): Promise<TResult> | TResult

  public static async execute<TArgs extends Record<string, any> = any, TResult = void>(
    this: new (args: TArgs) => Command<TArgs, TResult>,
    args: TArgs
  ): Promise<TResult> {
    const instance: Command<TArgs, TResult> = new this(args)

    return instance.handle()
  }
}

export { Command }
