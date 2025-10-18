class LazyRelationProxy<T> {
  public constructor(
    private loader: () => T,
    private cache: Map<string, any>,
    private cacheKey: string
  ) {}

  public load(): T {
    if (!this.cache.has(this.cacheKey)) {
      this.cache.set(this.cacheKey, this.loader())
    }

    return this.cache.get(this.cacheKey)
  }
}

export { LazyRelationProxy }
