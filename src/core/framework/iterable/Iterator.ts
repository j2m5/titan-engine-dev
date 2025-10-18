interface Iterator<T> {
  current(): T
  next(): T
  key(): number
  isDone(): boolean
  reset(): void
}

export type { Iterator }
