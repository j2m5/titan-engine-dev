type ComparisonOperator = '>' | '>=' | '<' | '<=' | '!==' | '==='

/**
 * Ключи формы, значения которых числовые. Нужен, чтобы sum/avg принимали
 * только те поля, которые действительно можно складывать.
 */
export type NumericKeys<TShape> = {
  [K in keyof TShape]: TShape[K] extends number ? K : never
}[keyof TShape]

/**
 * @typeParam T - тип элемента коллекции
 * @typeParam TShape - форма, из которой берутся строковые ключи для sortBy/pluck/where.
 *   Для плоской коллекции это сам элемент, для ModelCollection — атрибуты модели.
 */
class Collection<T, TShape = T> implements Iterable<T> {
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

    return new Collection(result)
  }

  public map<U>(callback: (item: T, index: number) => U): Collection<U> {
    return new Collection(this.items.map(callback))
  }

  public filter(callback: (item: T, index: number) => boolean): this {
    return this.instance(this.items.filter(callback))
  }

  public reject(callback: (item: T, index: number) => boolean): this {
    return this.instance(this.items.filter((item, index) => !callback(item, index)))
  }

  public sortBy<K extends keyof TShape>(key: K, direction: 'asc' | 'desc' = 'asc'): this {
    const sorted = [...this.items].sort((a, b) => {
      const aVal: TShape[K] | undefined = this.value(a, key)
      const bVal: TShape[K] | undefined = this.value(b, key)

      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }

      if (this.greaterThan(aVal, bVal)) return direction === 'asc' ? 1 : -1
      if (this.greaterThan(bVal, aVal)) return direction === 'asc' ? -1 : 1

      return 0
    })

    return this.instance(sorted)
  }

  public sortByDesc<K extends keyof TShape>(key: K): this {
    return this.sortBy(key, 'desc')
  }

  public unique<K extends keyof TShape>(key?: K): this {
    if (key === undefined) {
      return this.instance(Array.from(new Set(this.items)))
    }

    const seen = new Set<TShape[K] | undefined>()

    return this.filter((item) => {
      const value: TShape[K] | undefined = this.value(item, key)

      if (seen.has(value)) return false

      seen.add(value)

      return true
    })
  }

  public chunk(size: number): this[] {
    const chunks: this[] = []

    for (let i = 0; i < this.items.length; i += size) {
      chunks.push(this.instance(this.items.slice(i, i + size)))
    }

    return chunks
  }

  public partition(key: (item: T) => boolean): [this, this] {
    const passed: T[] = []
    const failed: T[] = []

    this.items.forEach((item: T): void => {
      ;(key(item) ? passed : failed).push(item)
    })

    return [this.instance(passed), this.instance(failed)]
  }

  public take(limit: number): this {
    return this.instance(this.items.slice(0, limit))
  }

  public skip(offset: number): this {
    return this.instance(this.items.slice(offset))
  }

  public unshift(...items: T[]): this {
    this.items.unshift(...items)

    return this
  }

  public push(...items: T[]): this {
    this.items.push(...items)

    return this
  }

  public splice(start: number, deleteCount: number = 0, ...items: T[]): this {
    this.items.splice(start, deleteCount, ...items)

    return this
  }

  public pop(): T | undefined {
    return this.items.pop()
  }

  public shift(): T | undefined {
    return this.items.shift()
  }

  public slice(start?: number, end?: number): this {
    return this.instance(this.items.slice(start, end))
  }

  public each(callback: (item: T, index: number) => void | false): this {
    for (let i: number = 0; i < this.items.length; i++) {
      if (callback(this.items[i], i) === false) {
        break
      }
    }

    return this
  }

  public eachSpread(
    callback: T extends readonly unknown[] ? (...args: [...T, number]) => void : (item: T, index: number) => void
  ): this {
    // условный тип не вызываем напрямую: внутри реализации ветка неизвестна,
    // а рантайм-разбор ниже как раз и выбирает форму вызова
    const invoke = callback as (...args: unknown[]) => void

    this.items.forEach((item, key) => {
      if (Array.isArray(item)) {
        invoke(...item, key)
      } else {
        invoke(item, key)
      }
    })

    return this
  }

  public tap(callback: (collection: Collection<T, TShape>) => void): this {
    callback(this)

    return this
  }

  public pipe<U>(callback: (collection: Collection<T, TShape>) => U): U {
    return callback(this)
  }

  public intersect(other: Collection<T, TShape>): this {
    const set = new Set(other.all())

    return this.filter((item) => set.has(item))
  }

  public diff(other: Collection<T, TShape>): this {
    const set = new Set(other.all())

    return this.filter((item) => !set.has(item))
  }

  public when<U>(condition: boolean | ((collection: this) => boolean), callback: (collection: this) => U): U | this {
    const shouldExecute: boolean = typeof condition === 'function' ? condition(this) : condition

    return shouldExecute ? callback(this) : this
  }

  public unless<U>(condition: boolean | ((collection: this) => boolean), callback: (collection: this) => U): U | this {
    const shouldExecute: boolean = typeof condition === 'function' ? condition(this) : condition

    return !shouldExecute ? callback(this) : this
  }

  public flatten(depth: number = Infinity): this {
    const flattenRecursive = (arr: T[], currentDepth: number): T[] => {
      if (currentDepth === 0) return arr.slice()

      return arr.reduce<T[]>((acc, item) => {
        if (Array.isArray(item)) {
          acc.push(...flattenRecursive(item as T[], currentDepth - 1))
        } else {
          acc.push(item)
        }

        return acc
      }, [])
    }

    return this.instance(flattenRecursive(this.items, depth))
  }

  public pluck<K extends keyof TShape>(key: K): (TShape[K] | undefined)[] {
    return this.items.map((item) => this.value(item, key))
  }

  public sum(key?: NumericKeys<TShape>): number {
    if (key === undefined) {
      return this.items.reduce((sum: number, item) => sum + (typeof item === 'number' ? item : 0), 0)
    }

    return this.items.reduce((sum: number, item) => {
      const value = this.value(item, key as keyof TShape)

      return sum + (typeof value === 'number' ? value : 0)
    }, 0)
  }

  public avg(key?: NumericKeys<TShape>): number {
    if (this.isEmpty()) return 0

    let count = 0
    const total = this.items.reduce((sum: number, item) => {
      const value = key !== undefined ? this.value(item, key as keyof TShape) : item
      if (typeof value === 'number') {
        count++

        return sum + value
      }

      return sum
    }, 0)

    return count === 0 ? 0 : total / count
  }

  public min(): T | undefined
  public min<K extends keyof TShape>(key: K): TShape[K] | undefined
  public min<K extends keyof TShape>(key?: K): T | TShape[K] | undefined {
    let result: T | TShape[K] | undefined = undefined

    for (const item of this.items) {
      const value: T | TShape[K] | undefined = key !== undefined ? this.value(item, key) : item
      if (value == null) continue

      if (result === undefined || this.greaterThan(result, value)) {
        result = value
      }
    }

    return result
  }

  public max(): T | undefined
  public max<K extends keyof TShape>(key: K): TShape[K] | undefined
  public max<K extends keyof TShape>(key?: K): T | TShape[K] | undefined {
    let result: T | TShape[K] | undefined = undefined

    for (const item of this.items) {
      const value: T | TShape[K] | undefined = key !== undefined ? this.value(item, key) : item
      if (value == null) continue

      if (result === undefined || this.greaterThan(value, result)) {
        result = value
      }
    }

    return result
  }

  public groupBy<K extends keyof TShape>(key: K | ((item: T) => PropertyKey)): Map<PropertyKey, this> {
    const result = new Map<PropertyKey, T[]>()

    for (const item of this.items) {
      const groupKey: PropertyKey = this.propertyKeyOf(item, key)

      if (!result.has(groupKey)) {
        result.set(groupKey, [])
      }

      result.get(groupKey)!.push(item)
    }

    const groups = new Map<PropertyKey, this>()
    for (const [groupKey, items] of result.entries()) {
      groups.set(groupKey, this.instance(items))
    }

    return groups
  }

  public keyBy<K extends keyof TShape>(key: K | ((item: T) => PropertyKey)): Map<PropertyKey, T> {
    const map = new Map<PropertyKey, T>()

    for (const item of this.items) {
      map.set(this.propertyKeyOf(item, key), item)
    }

    return map
  }

  public some<K extends keyof TShape>(
    key: ((item: T) => boolean) | K,
    operator?: ComparisonOperator,
    value?: TShape[K]
  ): boolean {
    if (typeof key === 'function') {
      return this.items.some(key)
    }

    return this.items.some((item) => this.compare(this.value(item, key), operator || '===', value))
  }

  public every<K extends keyof TShape>(
    key: ((item: T) => boolean) | K,
    operator?: ComparisonOperator,
    value?: TShape[K]
  ): boolean {
    if (typeof key === 'function') {
      return this.items.every(key)
    }

    return this.items.every((item) => this.compare(this.value(item, key), operator || '===', value))
  }

  public contains<K extends keyof TShape>(
    key: ((item: T) => boolean) | K,
    operator?: ComparisonOperator,
    value?: TShape[K]
  ): boolean {
    return this.some(key, operator, value)
  }

  public where<K extends keyof TShape>(key: K, value: TShape[K]): this
  public where<K extends keyof TShape>(key: K, operator: ComparisonOperator, value: TShape[K]): this
  public where(conditions: Partial<TShape>): this
  public where(...args: unknown[]): this {
    let filtered: T[]

    // where({ a: 1, b: 2 })
    if (typeof args[0] === 'object' && args.length === 1) {
      const conditions = args[0] as Partial<TShape>
      filtered = this.items.filter((item) =>
        Object.entries(conditions).every(([key, value]) => this.value(item, key as keyof TShape) === value)
      )
    } else {
      const { key, operator, value } = this.operatorForWhere(args)
      filtered = this.items.filter((item) => this.compare(this.value(item, key), operator, value))
    }

    return this.instance(filtered)
  }

  public whereIn<K extends keyof TShape>(key: K, values: TShape[K][]): this {
    return this.filter((item) => values.includes(this.value(item, key) as TShape[K]))
  }

  public whereNotIn<K extends keyof TShape>(key: K, values: TShape[K][]): this {
    return this.filter((item) => !values.includes(this.value(item, key) as TShape[K]))
  }

  public whereNull<K extends keyof TShape>(key: K): this {
    return this.where(key, '===', null as TShape[K])
  }

  public whereNotNull<K extends keyof TShape>(key: K): this {
    return this.where(key, '!==', null as TShape[K])
  }

  public whereBetween<K extends keyof TShape>(key: K, range: [TShape[K], TShape[K]]): this {
    const [min, max] = range

    return this.where(key, '>=', min).where(key, '<=', max)
  }

  public whereNotBetween<K extends keyof TShape>(key: K, range: [TShape[K], TShape[K]]): this {
    const [min, max] = range

    return this.filter(
      (item) => this.compare(this.value(item, key), '<', min) || this.compare(this.value(item, key), '>', max)
    )
  }

  public toArray(): T[] {
    return this.items
  }

  protected value<K extends keyof TShape>(item: T, key: K): TShape[K] | undefined {
    return (item as unknown as TShape | undefined)?.[key]
  }

  protected instance(items: T[]): this {
    return new (this.constructor as new (items: T[]) => this)(items)
  }

  protected operatorForWhere(args: unknown[]): { key: keyof TShape; operator: ComparisonOperator; value: unknown } {
    if (args.length === 2) {
      return { key: args[0] as keyof TShape, operator: '===', value: args[1] }
    }

    if (args.length === 3) {
      return { key: args[0] as keyof TShape, operator: args[1] as ComparisonOperator, value: args[2] }
    }

    throw new Error('Invalid where arguments')
  }

  protected compare(a: unknown, operator: ComparisonOperator, b: unknown): boolean {
    switch (operator) {
      case '>':
        return (a as number) > (b as number)
      case '>=':
        return (a as number) >= (b as number)
      case '<':
        return (a as number) < (b as number)
      case '<=':
        return (a as number) <= (b as number)
      case '!==':
        return a !== b
      default:
        return a === b
    }
  }

  /**
   * Порядковое сравнение значений неизвестного типа: TShape[K] не сужается до
   * number/string, поэтому оператор `>` применяется к приведенным операндам —
   * ровно так же, как это делает compare().
   */
  private greaterThan(a: unknown, b: unknown): boolean {
    return (a as number) > (b as number)
  }

  /**
   * Вычисляет ключ группировки: либо результат колбэка, либо значение поля.
   */
  private propertyKeyOf<K extends keyof TShape>(item: T, key: K | ((item: T) => PropertyKey)): PropertyKey {
    if (typeof key === 'function') {
      return key(item)
    }

    return this.value(item, key) as PropertyKey
  }

  /**
   * C намеренно без констрейнта: с границей `Collection<T, TShape>` вывод C
   * падает на саму границу, потому что ModelCollection<Actor> не assignable
   * к Collection<Actor, unknown>. Конструируемость гарантирует параметр this.
   *
   * Вывод C через this-параметр неточен для generic-классов (TS инстанцирует
   * конструктор границей его параметра), поэтому для ModelCollection аргументы
   * типов указываются явно на вызове.
   */
  public static make<T, C>(this: new (items?: T[]) => C, items: T[] = []): C {
    return new this(items)
  }
}

export { Collection }
