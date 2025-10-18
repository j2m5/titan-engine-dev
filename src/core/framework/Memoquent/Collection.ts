import { DataSource, Model } from '@/core/framework/Memoquent/Model.ts'

class Collection<TModel extends Model<any>> implements Iterable<TModel> {
  public constructor(protected items: TModel[] = []) {}

  [Symbol.iterator](): Iterator<TModel> {
    return this.items[Symbol.iterator]()
  }

  public all(): TModel[] {
    return this.items
  }

  public count(): number {
    return this.items.length
  }

  public isEmpty(): boolean {
    return this.items.length === 0
  }

  public isNotEmpty(): boolean {
    return this.items.length > 0
  }

  public get(index: number): TModel | undefined {
    return this.items[index]
  }

  public at(index: number): TModel | undefined {
    return this.items.at(index)
  }

  public first(callback?: (item: TModel, index: number) => boolean): TModel | undefined {
    if (!callback) {
      return this.items[0]
    }

    return this.items.find(callback)
  }

  public last(callback?: (item: TModel, index: number) => boolean): TModel | undefined {
    if (!callback) {
      return this.items[this.items.length - 1]
    }
    const filtered: TModel[] = this.items.filter(callback)

    return filtered[filtered.length - 1]
  }

  public find(id: number | string): TModel | undefined {
    return this.items.find((item: TModel): boolean => item.getAttribute(item.primaryKey) === id)
  }

  public where<K extends keyof TModel['attributes']>(key: K, value: any): Collection<TModel>
  public where<K extends keyof TModel['attributes']>(key: K, operator: string, value: any): Collection<TModel>
  public where(conditions: Partial<TModel['attributes']>): Collection<TModel>
  public where(...args: any[]): Collection<TModel> {
    let filtered: TModel[]

    if (typeof args[0] === 'object') {
      // where({ key: value, ... })
      const conditions = args[0]
      filtered = this.items.filter((item: TModel) =>
        Object.entries(conditions).every(([key, value]): boolean => item.getAttribute(key as any) === value)
      )
    } else if (args.length === 2) {
      // where('key', value)
      const [key, value] = args
      filtered = this.items.filter((item: TModel): boolean => item.getAttribute(key) === value)
    } else if (args.length === 3) {
      // where('key', '>', value)
      const [key, operator, value] = args
      filtered = this.items.filter((item: TModel): boolean => {
        const itemValue = item.getAttribute(key)
        switch (operator) {
          case '>':
            return itemValue > value
          case '>=':
            return itemValue >= value
          case '<':
            return itemValue < value
          case '<=':
            return itemValue <= value
          case '!=':
            return itemValue !== value
          case '===':
            return itemValue === value
          default:
            return itemValue === value
        }
      })
    } else {
      filtered = this.items
    }

    return new Collection(filtered)
  }

  public whereIn<K extends keyof TModel['attributes']>(key: K, values: any[]): Collection<TModel> {
    const filtered: TModel[] = this.items.filter((item: TModel) => values.includes(item.getAttribute(key as any)))

    return new Collection(filtered)
  }

  public whereNotIn<K extends keyof TModel['attributes']>(key: K, values: any[]): Collection<TModel> {
    const filtered: TModel[] = this.items.filter((item: TModel) => !values.includes(item.getAttribute(key as any)))

    return new Collection(filtered)
  }

  public map<U>(callback: (item: TModel, index: number) => U): U[] {
    return this.items.map(callback)
  }

  public mapToCollection<U extends Model<any>>(callback: (item: TModel, index: number) => U): Collection<U> {
    return new Collection(this.items.map(callback))
  }

  public filter(callback: (item: TModel, index: number) => boolean): Collection<TModel> {
    return new Collection(this.items.filter(callback))
  }

  public reject(callback: (item: TModel, index: number) => boolean): Collection<TModel> {
    return new Collection(this.items.filter((item, index) => !callback(item, index)))
  }

  public sortBy<K extends keyof TModel['attributes']>(key: K, direction: 'asc' | 'desc' = 'asc'): Collection<TModel> {
    const sorted: TModel[] = [...this.items].sort((a: TModel, b: TModel): number => {
      const aVal = a.getAttribute(key as any)
      const bVal = b.getAttribute(key as any)

      if (aVal === undefined && bVal === undefined) return 0
      if (aVal === undefined) return direction === 'asc' ? 1 : -1
      if (bVal === undefined) return direction === 'asc' ? -1 : 1

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }

      const comparison: number = aVal > bVal ? 1 : aVal < bVal ? -1 : 0
      return direction === 'asc' ? comparison : -comparison
    })

    return new Collection(sorted)
  }

  public sortByDesc<K extends keyof TModel['attributes']>(key: K): Collection<TModel> {
    return this.sortBy(key, 'desc')
  }

  public groupBy<K extends keyof TModel['attributes']>(key: K): Map<any, Collection<TModel>> {
    const groups: Map<any, TModel[]> = new Map<any, TModel[]>()

    this.items.forEach((item: TModel): void => {
      const value = item.getAttribute(key as any)
      if (!groups.has(value)) {
        groups.set(value, [])
      }
      groups.get(value)!.push(item)
    })

    const result: Map<any, Collection<TModel>> = new Map<any, Collection<TModel>>()
    groups.forEach((items: TModel[], key): void => {
      result.set(key, new Collection(items))
    })

    return result
  }

  public sum<K extends keyof TModel['attributes']>(key: K): number {
    return this.items.reduce((sum: number, item: TModel) => {
      const value = item.getAttribute(key as any)
      return sum + (typeof value === 'number' ? value : 0)
    }, 0)
  }

  public avg<K extends keyof TModel['attributes']>(key: K): number {
    if (this.isEmpty()) return 0
    return this.sum(key) / this.count()
  }

  public min<K extends keyof TModel['attributes']>(key: K): any {
    if (this.isEmpty()) return undefined

    return this.items.reduce(
      (min, item: TModel) => {
        const value = item.getAttribute(key as any)
        return value < min ? value : min
      },
      this.items[0].getAttribute(key as any)
    )
  }

  public max<K extends keyof TModel['attributes']>(key: K): any {
    if (this.isEmpty()) return undefined

    return this.items.reduce(
      (max, item: TModel) => {
        const value = item.getAttribute(key as any)
        return value > max ? value : max
      },
      this.items[0].getAttribute(key as any)
    )
  }

  public chunk(size: number): Collection<TModel>[] {
    const chunks: Collection<TModel>[] = []
    for (let i: number = 0; i < this.items.length; i += size) {
      chunks.push(new Collection(this.items.slice(i, i + size)))
    }

    return chunks
  }

  public take(limit: number): Collection<TModel> {
    return new Collection(this.items.slice(0, limit))
  }

  public skip(offset: number): Collection<TModel> {
    return new Collection(this.items.slice(offset))
  }

  public pluck<K extends keyof TModel['attributes']>(key: K): any[] {
    return this.items.map((item: TModel) => item.getAttribute(key as any))
  }

  public unique<K extends keyof TModel['attributes']>(key?: K): Collection<TModel> {
    if (!key) {
      return new Collection([...new Set(this.items)])
    }

    const seen = new Set()
    const unique: TModel[] = this.items.filter((item: TModel): boolean => {
      const value = item.getAttribute(key as any)
      if (seen.has(value)) {
        return false
      }
      seen.add(value)

      return true
    })

    return new Collection(unique)
  }

  public load(...relations: string[]): this {
    this.items.forEach((item: TModel): void => {
      item.with(...relations)
    })

    return this
  }

  public toArray(): TModel[] {
    return this.items
  }

  public toJSON(): any[] {
    return this.items.map((item: TModel) => item.toJSON())
  }

  public push(...items: TModel[]): this {
    this.items.push(...items)

    return this
  }

  public pop(): TModel | undefined {
    return this.items.pop()
  }

  public shift(): TModel | undefined {
    return this.items.shift()
  }

  public unshift(...items: TModel[]): this {
    this.items.unshift(...items)

    return this
  }

  public slice(start?: number, end?: number): Collection<TModel> {
    return new Collection(this.items.slice(start, end))
  }

  public each(callback: (item: TModel, index: number) => void | false): this {
    for (let i: number = 0; i < this.items.length; i++) {
      if (callback(this.items[i], i) === false) {
        break
      }
    }

    return this
  }

  public eachRecursive<TRelation extends keyof TModel>(
    callback: (item: TModel, depth: number, parent?: TModel) => void | false,
    childrenRelation: TRelation = 'children' as TRelation
  ): this {
    const traverse = (item: TModel, depth: number = 0, parent?: TModel): void | false => {
      const result: void | false = callback(item, depth, parent)

      if (result === false) {
        return false
      }

      const children = (item as any)[childrenRelation]

      if (children instanceof Collection) {
        children.each((child): void | false => {
          const childResult: void | false = traverse(child, depth + 1, item)

          return childResult === false ? false : undefined
        })
      }
    }

    this.items.forEach((item: TModel) => traverse(item))

    return this
  }

  public tap(callback: (collection: Collection<TModel>) => void): this {
    callback(this)

    return this
  }

  public pipe<U>(callback: (collection: Collection<TModel>) => U): U {
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

  public flatten<TRelation extends keyof TModel>(
    childrenRelation: TRelation = 'children' as TRelation
  ): Collection<TModel> {
    const flattened: TModel[] = []

    this.eachRecursive((item: TModel): void => {
      flattened.push(item)
    }, childrenRelation)

    return new Collection(flattened)
  }

  public static make<TModel extends Model<any>>(items: TModel[] = []): Collection<TModel> {
    return new Collection(items)
  }

  public static fromData<TData extends DataSource, TModel extends Model<TData>>(
    data: TData[],
    modelClass: new (attributes?: Partial<TData>) => TModel
  ): Collection<TModel> {
    const models: TModel[] = data.map((item: TData) => new modelClass(item))

    return new Collection(models)
  }
}

export { Collection }
