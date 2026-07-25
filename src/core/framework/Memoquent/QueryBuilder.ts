import { Model, ModelConstructor } from '@/core/framework/Memoquent/Model'
import { AttributesOf, ModelCollection } from '@/core/framework/Memoquent/ModelCollection'
import { Scope } from '@/core/framework/Memoquent/Scope'

/**
 * Ключи связей модели. Связи объявлены геттерами на классе, поэтому
 * выводятся по типу значения.
 *
 * ВАЖНО: нижняя граница коллекционной связи — ModelCollection<Model<object>>,
 * а НЕ ModelCollection<never>. С never проверка
 * `ModelCollection<Actor> extends ModelCollection<never>` не проходит
 * (never требует items: never[]), и все связи-коллекции, включая
 * Actor.children, молча выпадают из типа — код компилируется, просто
 * whereHas('children') перестает быть валидным.
 */
export type RelationKeys<TM> = {
  [K in keyof TM]: TM[K] extends ModelCollection<Model<object>> | Model<object> | null ? K : never
}[keyof TM]

type WhereHas<TModel> = {
  relation: RelationKeys<TModel>
  callback?: (collection: ModelCollection<Model<object>>) => ModelCollection<Model<object>>
  negate?: boolean
}

type WhereIn<TData, K extends keyof TData = keyof TData> = {
  field: K
  values: TData[K][]
  negate?: boolean
}

type WhereNull<TData> = {
  field: keyof TData
  negate?: boolean
}

type WhereBetween<TData, K extends keyof TData = keyof TData> = {
  field: K
  range: [TData[K], TData[K]]
  negate?: boolean
}

class QueryBuilder<TData extends object, TModel extends Model<TData>> {
  private _conditions?: Partial<TData>
  private _whereHas: WhereHas<TModel>[] = []
  private _whereIn: WhereIn<TData>[] = []
  private _whereNull: WhereNull<TData>[] = []
  private _whereBetween: WhereBetween<TData>[] = []
  private _limit?: number
  private _offset?: number
  private _orderBy?: { field: keyof TData; direction: 'asc' | 'desc' }

  private scopesApplied: boolean = false
  private removedScopes: Set<string> = new Set()

  public constructor(private modelClass: ModelConstructor<TData, TModel>) {}

  private applyGlobalScopes(): void {
    if (this.scopesApplied) return
    this.scopesApplied = true

    const scopes = this.modelClass.getGlobalScopes()

    scopes.forEach((scope: Scope<object, Model<object>>, name: string): void => {
      if (!this.removedScopes.has(name)) {
        // Карта скоупов типизована по нижней границе (статика не видит параметры
        // типа класса), поэтому сужение до конкретного билдера локально.
        // Переход через unknown обязателен: RelationKeys<Model<object>> = never,
        // поэтому QueryBuilder<TData, TModel> и QueryBuilder<object, Model<object>>
        // не сравнимы напрямую (приватное поле _whereHas делает параметр TModel
        // инвариантным). Скоуп получает ровно тот билдер, к которому применяется.
        ;(scope as unknown as Scope<TData, TModel>).apply(this)
      }
    })
  }

  public withoutGlobalScope(scope: string): this {
    this.removedScopes.add(scope)

    return this
  }

  public withoutGlobalScopes(scopes: string[] = []): this {
    if (!scopes.length) {
      scopes = Array.from(this.modelClass.getGlobalScopes().keys())
    }

    scopes.forEach((scope: string) => this.withoutGlobalScope(scope))

    return this
  }

  public where(conditions: Partial<TData>): this {
    this._conditions = { ...this._conditions, ...conditions }

    return this
  }

  public whereHas(
    relation: RelationKeys<TModel>,
    callback?: (collection: ModelCollection<Model<object>>) => ModelCollection<Model<object>>
  ): this {
    this._whereHas.push({ relation, callback })

    return this
  }

  public whereDoesntHave(
    relation: RelationKeys<TModel>,
    callback?: (collection: ModelCollection<Model<object>>) => ModelCollection<Model<object>>
  ): this {
    this._whereHas.push({ relation, callback, negate: true })

    return this
  }

  public whereIn<TKey extends keyof TData>(field: TKey, values: TData[TKey][]): this {
    this._whereIn.push({ field, values, negate: false })

    return this
  }

  public whereNotIn<TKey extends keyof TData>(field: TKey, values: TData[TKey][]): this {
    this._whereIn.push({ field, values, negate: true })

    return this
  }

  public whereNull<TKey extends keyof TData>(field: TKey): this {
    this._whereNull.push({ field, negate: false })

    return this
  }

  public whereNotNull<TKey extends keyof TData>(field: TKey): this {
    this._whereNull.push({ field, negate: true })

    return this
  }

  public whereBetween<TKey extends keyof TData>(field: TKey, range: [TData[TKey], TData[TKey]]): this {
    this._whereBetween.push({ field, range, negate: false })

    return this
  }

  public whereNotBetween<TKey extends keyof TData>(field: TKey, range: [TData[TKey], TData[TKey]]): this {
    this._whereBetween.push({ field, range, negate: true })

    return this
  }

  public limit(count: number): this {
    this._limit = count

    return this
  }

  public offset(count: number): this {
    this._offset = count

    return this
  }

  public skip(count: number): this {
    return this.offset(count)
  }

  public take(count: number): this {
    return this.limit(count)
  }

  public orderBy(field: keyof TData, direction: 'asc' | 'desc' = 'asc'): this {
    this._orderBy = { field, direction }

    return this
  }

  public orderByDesc(field: keyof TData): this {
    return this.orderBy(field, 'desc')
  }

  public get(): ModelCollection<TModel> {
    this.applyGlobalScopes()

    const instance: TModel = new this.modelClass()
    const rows: TData[] = instance.source()
    const conditions = this._conditions

    const matched: TData[] = conditions
      ? rows.filter((row: TData) =>
          (Object.entries(conditions) as [keyof TData, TData[keyof TData]][]).every(
            ([key, value]) => row[key] === value
          )
        )
      : rows

    let collection: ModelCollection<TModel> = new ModelCollection(matched.map((row: TData) => new this.modelClass(row)))

    if (this._whereHas.length > 0) {
      collection = collection.filter((model: TModel) => {
        return this._whereHas.every(({ relation, callback, negate }) => {
          const related: ModelCollection<Model<object>> = this.normalizeRelation(model[relation])

          const exists: boolean = callback ? callback(related).isNotEmpty() : related.isNotEmpty()

          return negate ? !exists : exists
        })
      })
    }

    if (this._whereIn.length > 0) {
      collection = collection.filter((model: TModel) => {
        return this._whereIn.every(({ field, values, negate }) => {
          const value = this.fieldValue(model, field)
          const exists = (values as unknown[]).includes(value)

          return negate ? !exists : exists
        })
      })
    }

    if (this._whereNull.length > 0) {
      collection = collection.filter((model: TModel) => {
        return this._whereNull.every(({ field, negate }) => {
          const isNull = this.fieldValue(model, field) === null

          return negate ? !isNull : isNull
        })
      })
    }

    if (this._whereBetween.length > 0) {
      collection = collection.filter((model: TModel) => {
        return this._whereBetween.every(({ field, range, negate }) => {
          const value = this.fieldValue(model, field)

          if (value === null) {
            return false
          }

          const [min, max] = range
          const inRange = value >= min && value <= max

          return negate ? !inRange : inRange
        })
      })
    }

    if (this._orderBy) {
      collection = collection.sortBy(this._orderBy.field as keyof AttributesOf<TModel>, this._orderBy.direction)
    }

    if (this._offset !== undefined) {
      collection = collection.skip(this._offset)
    }

    if (this._limit !== undefined) {
      collection = collection.take(this._limit)
    }

    return collection
  }

  public paginate(
    page: number,
    perPage: number = 15
  ): {
    data: ModelCollection<TModel>
    total: number
    perPage: number
    currentPage: number
    lastPage: number
  } {
    const total = this.count()
    const lastPage = Math.ceil(total / perPage)
    const currentPage = Math.min(Math.max(1, page), lastPage)

    const data = this.offset((currentPage - 1) * perPage)
      .limit(perPage)
      .get()

    return {
      data,
      total,
      perPage,
      currentPage,
      lastPage
    }
  }

  public first(): TModel | null {
    const collection: ModelCollection<TModel> = this.limit(1).get()

    return collection.first() || null
  }

  public exists(): boolean {
    return this.limit(1).get().isNotEmpty()
  }

  public count(): number {
    return this.get().count()
  }

  public pluck<TKey extends keyof TData>(field: TKey): (TData[TKey] | undefined)[] {
    // связь TData <-> AttributesOf<TModel> компилятору недоступна, пока TModel
    // остается свободным параметром — касты локальны и не вводят any
    return this.get().pluck(field as keyof AttributesOf<TModel>) as (TData[TKey] | undefined)[]
  }

  public toArray(): TModel[] {
    return this.get().toArray()
  }

  /**
   * Значение поля для предикатов where*: отсутствующее читается как null.
   *
   * Читаем attributes напрямую, а не через getAttribute: тот подменяет
   * defaultValue по falsy (attributes[key] || defaultValue), из-за чего
   * хранимые 0 и '' считались null (whereNull находил их), а вызов без
   * defaultValue вообще вернул бы '-' вместо null.
   */
  private fieldValue(model: TModel, field: keyof TData): NonNullable<TData[keyof TData]> | null {
    return model.attributes[field] ?? null
  }

  private normalizeRelation(value: unknown): ModelCollection<Model<object>> {
    if (value instanceof ModelCollection) {
      return value as ModelCollection<Model<object>>
    }

    if (value instanceof Model) {
      return new ModelCollection([value as Model<object>])
    }

    return new ModelCollection([])
  }
}

export { QueryBuilder }
