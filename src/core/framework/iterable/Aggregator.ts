import { Iterator } from '@/core/framework/iterable/Iterator'

interface Aggregator<T> {
  getIterator(): Iterator<T>
}

export type { Aggregator }
