type ComparisonOperator = '>' | '>=' | '<' | '<=' | '!==' | '==='

class Collection<T> implements Iterable<T> {
  protected items: T[]

  public constructor(items: T[] = []) {
    this.items = items
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]()
  }

  public all(): T[] {
    return this.items
  }

  public count(callback?: (item: T) => boolean): number {
    if (!callback) {
      return this.items.length
    }

    let count: number = 0
    for (const item of this.items) {
      if (callback(item)) count++
    }

    return count
  }

  public isEmpty(): boolean {
    return this.items.length === 0
  }

  public isNotEmpty(): boolean {
    return this.items.length > 0
  }

  public get(index: number): T | undefined {
    return this.items[index]
  }

  public at(index: number): T | undefined {
    return this.items.at(index)
  }

  public first(callback?: (item: T, index: number) => boolean): T | undefined {
    if (!callback) {
      return this.items[0]
    }

    return this.items.find(callback)
  }

  public last(callback?: (item: T, index: number) => boolean): T | undefined {
    if (!callback) {
      return this.items[this.items.length - 1]
    }
    const filtered: T[] = this.items.filter(callback)

    return filtered[filtered.length - 1]
  }

  public flatMap<U>(callback: (item: T, index: number) => U[] | Collection<U>): Collection<U> {
    const result: U[] = []

    this.items.forEach((item, index): void => {
      const mapped = callback(item, index)

      if (mapped instanceof Collection) {
        result.push(...mapped.all())
      } else {
        result.push(...mapped)
      }
    })

    return new (this.constructor as any)(result)
  }

  public map<U>(callback: (item: T, index: number) => U): Collection<U> {
    return new (this.constructor as any)(this.items.map(callback))
  }

  public filter(callback: (item: T, index: number) => boolean): Collection<T> {
    return new (this.constructor as any)(this.items.filter(callback))
  }

  public reject(callback: (item: T, index: number) => boolean): Collection<T> {
    return new (this.constructor as any)(this.items.filter((item, index) => !callback(item, index)))
  }

  public sortBy(key: string, direction: 'asc' | 'desc' = 'asc'): Collection<T> {
    const sorted = [...this.items].sort((a, b) => {
      const aVal = this.value(a, key)
      const bVal = this.value(b, key)

      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }

      if (aVal > bVal) return direction === 'asc' ? 1 : -1
      if (aVal < bVal) return direction === 'asc' ? -1 : 1

      return 0
    })

    return new (this.constructor as any)(sorted)
  }

  public sortByDesc(key: string): Collection<T> {
    return this.sortBy(key, 'desc')
  }

  public unique(key?: string): Collection<T> {
    if (!key) {
      return new (this.constructor as any)(Array.from(new Set(this.items)))
    }

    const seen = new Set()

    return this.filter((item) => {
      const value = this.value(item, key)

      if (seen.has(value)) return false

      seen.add(value)

      return true
    })
  }

  public chunk(size: number): Collection<T>[] {
    const chunks: Collection<T>[] = []
    for (let i: number = 0; i < this.items.length; i += size) {
      chunks.push(new (this.constructor as any)(this.items.slice(i, i + size)))
    }

    return chunks
  }

  public take(limit: number): Collection<T> {
    return new (this.constructor as any)(this.items.slice(0, limit))
  }

  public skip(offset: number): Collection<T> {
    return new (this.constructor as any)(this.items.slice(offset))
  }

  public unshift(...items: T[]): this {
    this.items.unshift(...items)

    return this
  }

  public push(...items: T[]): this {
    this.items.push(...items)

    return this
  }

  public pop(): T | undefined {
    return this.items.pop()
  }

  public shift(): T | undefined {
    return this.items.shift()
  }

  public slice(start?: number, end?: number): Collection<T> {
    return new (this.constructor as any)(this.items.slice(start, end))
  }

  public each(callback: (item: T, index: number) => void | false): this {
    for (let i: number = 0; i < this.items.length; i++) {
      if (callback(this.items[i], i) === false) {
        break
      }
    }

    return this
  }

  public eachSpread(callback: (...args: any[]) => void): this {
    this.items.forEach((item, key) => {
      if (Array.isArray(item)) {
        callback(...item, key)
      } else {
        callback(item, key)
      }
    })

    return this
  }

  public tap(callback: (collection: Collection<T>) => void): this {
    callback(this)

    return this
  }

  public pipe<U>(callback: (collection: Collection<T>) => U): U {
    return callback(this)
  }

  public when<U>(condition: boolean | ((collection: this) => boolean), callback: (collection: this) => U): U | this {
    const shouldExecute: boolean = typeof condition === 'function' ? condition(this) : condition

    return shouldExecute ? callback(this) : this
  }

  public unless<U>(condition: boolean | ((collection: this) => boolean), callback: (collection: this) => U): U | this {
    const shouldExecute: boolean = typeof condition === 'function' ? condition(this) : condition

    return !shouldExecute ? callback(this) : this
  }

  public flatten(depth: number = Infinity): Collection<T> {
    const flattenRecursive = (arr: T[], currentDepth: number): T[] => {
      if (currentDepth === 0) return arr.slice()

      return arr.reduce<any[]>((acc, item) => {
        if (Array.isArray(item)) {
          acc.push(...flattenRecursive(item, currentDepth - 1))
        } else {
          acc.push(item)
        }
        return acc
      }, [])
    }

    return new (this.constructor as any)(flattenRecursive(this.items, depth))
  }

  public pluck(key: string): any[] {
    return this.items.map((item) => this.value(item, key))
  }

  public sum(key?: string): number {
    if (!key) {
      return this.items.reduce((sum, item) => sum + (typeof item === 'number' ? item : 0), 0)
    }

    return this.items.reduce((sum, item) => {
      const value = this.value(item, key)

      return sum + (typeof value === 'number' ? value : 0)
    }, 0)
  }

  public avg(key?: string): number {
    if (this.isEmpty()) return 0

    let count = 0
    const total = this.items.reduce((sum, item) => {
      const value = key ? this.value(item, key) : item
      if (typeof value === 'number') {
        count++

        return sum + value
      }

      return sum
    }, 0)

    return count === 0 ? 0 : total / count
  }

  public min(key?: string): any {
    let result: any = undefined

    for (const item of this.items) {
      const value = key ? this.value(item, key) : item
      if (value == null) continue

      if (result === undefined || value < result) {
        result = value
      }
    }

    return result
  }

  public max(key?: string): any {
    let result: any = undefined

    for (const item of this.items) {
      const value = key ? this.value(item, key) : item
      if (value == null) continue

      if (result === undefined || value > result) {
        result = value
      }
    }

    return result
  }

  public groupBy(key: string | ((item: T) => any)): Map<any, Collection<T>> {
    const groups = new Map<any, T[]>()

    for (const item of this.items) {
      const groupKey = typeof key === 'function' ? key(item) : this.value(item, key)

      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }

      groups.get(groupKey)!.push(item)
    }

    const result = new Map<any, Collection<T>>()
    for (const [groupKey, items] of groups.entries()) {
      result.set(groupKey, new (this.constructor as any)(items))
    }

    return result
  }

  public keyBy(key: string | ((item: T) => any)): Map<any, T> {
    const map = new Map<any, T>()

    for (const item of this.items) {
      const mapKey = typeof key === 'function' ? key(item) : this.value(item, key)

      map.set(mapKey, item)
    }

    return map
  }

  public some(key: ((item: T) => boolean) | string, operator?: ComparisonOperator, value?: any): boolean {
    if (typeof key === 'function') {
      return this.items.some(key)
    }

    return this.items.some((item) => this.compare(this.value(item, key), operator || '===', value))
  }

  public every(key: ((item: T) => boolean) | string, operator?: ComparisonOperator, value?: any): boolean {
    if (typeof key === 'function') {
      return this.items.every(key)
    }

    return this.items.every((item) => this.compare(this.value(item, key), operator || '===', value))
  }

  public contains(key: ((item: T) => boolean) | string, operator?: ComparisonOperator, value?: any): boolean {
    return this.some(key as any, operator, value)
  }

  public where(key: string, value: any): Collection<T>
  public where(key: string, operator: ComparisonOperator, value: any): Collection<T>
  public where(conditions: Record<string, any>): Collection<T>
  public where(...args: any[]): Collection<T> {
    let filtered: T[]

    // where({ a: 1, b: 2 })
    if (typeof args[0] === 'object' && args.length === 1) {
      const conditions = args[0]
      filtered = this.items.filter((item) =>
        Object.entries(conditions).every(([key, value]) => this.value(item, key) === value)
      )
    } else {
      const { key, operator, value } = this.operatorForWhere(args)
      filtered = this.items.filter((item) => this.compare(this.value(item, key), operator, value))
    }

    return new (this.constructor as any)(filtered)
  }

  public whereIn(key: string, values: any[]): Collection<T> {
    return this.filter((item) => values.includes(this.value(item, key)))
  }

  public whereNotIn(key: string, values: any[]): Collection<T> {
    return this.filter((item) => !values.includes(this.value(item, key)))
  }

  public whereNull(key: string): Collection<T> {
    return this.where(key, '===', null)
  }

  public whereNotNull(key: string): Collection<T> {
    return this.where(key, '!==', null)
  }

  public whereBetween(key: string, range: [any, any]): Collection<T> {
    const [min, max] = range

    return this.where(key, '>=', min).where(key, '<=', max)
  }

  public whereNotBetween(key: string, range: [any, any]): Collection<T> {
    const [min, max] = range

    return this.filter((item) => this.value(item, key) < min || this.value(item, key) > max)
  }

  public toArray(): T[] {
    return this.items
  }

  protected value(item: T, key: keyof any): any {
    return (item as any)?.[key]
  }

  protected operatorForWhere(args: any[]): { key: any; operator: ComparisonOperator; value: any } {
    if (args.length === 2) {
      return { key: args[0], operator: '===', value: args[1] }
    }

    if (args.length === 3) {
      return { key: args[0], operator: args[1], value: args[2] }
    }

    throw new Error('Invalid where arguments')
  }

  protected compare(a: any, operator: ComparisonOperator, b: any): boolean {
    switch (operator) {
      case '>':
        return a > b
      case '>=':
        return a >= b
      case '<':
        return a < b
      case '<=':
        return a <= b
      case '!==':
        return a !== b
      default:
        return a === b
    }
  }

  public static make<T, C extends Collection<T>>(this: new (items?: T[]) => C, items: T[] = []): C {
    return new this(items)
  }
}

export { Collection }
