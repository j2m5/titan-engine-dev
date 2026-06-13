import { DataSource, Model, ModelConstructor } from '@/core/framework/Memoquent/Model'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'
import { Scope } from '@/core/framework/Memoquent/Scope'

type WhereHas = {
  relation: string
  callback?: (collection: ModelCollection<any>) => ModelCollection<any>
  negate?: boolean
}

type WhereIn<TData> = {
  field: keyof TData
  values: any[]
  negate?: boolean
}

type WhereNull<TData> = {
  field: keyof TData
  negate?: boolean
}

type WhereBetween<TData> = {
  field: keyof TData
  range: [any, any]
  negate?: boolean
}

class QueryBuilder<TData extends DataSource, TModel extends Model<TData>> {
  private _conditions?: Partial<TData>
  private _whereHas: WhereHas[] = []
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

    const scopes = (this.modelClass as any).getGlobalScopes()

    scopes.forEach((scope: Scope<TData, TModel>, name: string): void => {
      if (!this.removedScopes.has(name)) {
        scope.apply(this)
      }
    })
  }

  public withoutGlobalScope(scope: string): this {
    this.removedScopes.add(scope)

    return this
  }

  public withoutGlobalScopes(scopes: string[] = []): this {
    if (!scopes.length) {
      scopes = Array.from((this.modelClass as any).getGlobalScopes().keys())
    }

    scopes.forEach((scope: string) => this.withoutGlobalScope(scope))

    return this
  }

  public where(conditions: Partial<TData>): this {
    this._conditions = { ...this._conditions, ...conditions }

    return this
  }

  public whereHas(relation: string, callback?: (collection: ModelCollection<any>) => ModelCollection<any>): this {
    this._whereHas.push({ relation, callback })

    return this
  }

  public whereDoesntHave(
    relation: string,
    callback?: (collection: ModelCollection<any>) => ModelCollection<any>
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

    const ModelClass = this.modelClass as any
    let collection: ModelCollection<TModel> = this._conditions ? ModelClass.where(this._conditions) : ModelClass.all()

    if (this._whereHas.length > 0) {
      collection = collection.filter((model: TModel) => {
        return this._whereHas!.every(({ relation, callback, negate }) => {
          const rawRelated = (model as any)[relation]
          const related: ModelCollection<any> = this.normalizeRelation(rawRelated)

          let exists: boolean

          if (!callback) {
            exists = related.isNotEmpty()
          } else {
            exists = callback(related).isNotEmpty()
          }

          return negate ? !exists : exists
        })
      })
    }

    if (this._whereIn.length > 0) {
      collection = collection.filter((model: TModel) => {
        return this._whereIn.every(({ field, values, negate }) => {
          const value = model.getAttribute(field as any, null)
          const exists = values.includes(value)

          return negate ? !exists : exists
        })
      })
    }

    if (this._whereNull.length > 0) {
      collection = collection.filter((model: TModel) => {
        return this._whereNull.every(({ field, negate }) => {
          const value = model.getAttribute(field as any, null)
          const isNull = value === null

          return negate ? !isNull : isNull
        })
      })
    }

    if (this._whereBetween.length > 0) {
      collection = collection.filter((model: TModel) => {
        return this._whereBetween.every(({ field, range, negate }) => {
          const value = model.getAttribute(field as any, null)

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
      collection = collection.sortBy(this._orderBy.field as any, this._orderBy.direction)
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

  public pluck<TKey extends keyof TData>(field: TKey): TData[TKey][] {
    return this.get().pluck(field as any)
  }

  public toArray(): TModel[] {
    return this.get().toArray()
  }

  private normalizeRelation(value: any): ModelCollection<any> {
    if (value instanceof ModelCollection) {
      return value
    }

    if (value instanceof Model) {
      return new ModelCollection([value])
    }

    return new ModelCollection([])
  }
}

export { QueryBuilder }
