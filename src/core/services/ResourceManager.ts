import type { Loader } from 'three'

abstract class ResourceManager<TSource, TData = unknown, TUrl = string> {
  protected abstract loader: Loader<TData, TUrl>

  public abstract load(source: TSource): Promise<TData | undefined>

  public async loadAll(sources: TSource[]): Promise<void> {
    const loadPromises: Promise<TData | undefined>[] = sources.map((source: TSource) => this.load(source))
    await Promise.all(loadPromises)
  }

  public abstract remove(key: string): void
  public abstract removeAll(): void
}

export { ResourceManager }
