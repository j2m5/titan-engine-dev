interface Acceptable<T> {
  accept(visitor: T): void
}

export type { Acceptable }
