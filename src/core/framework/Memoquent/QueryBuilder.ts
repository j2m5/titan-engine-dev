import { DataSource, Model, ModelConstructor } from '@/core/framework/Memoquent/Model'
import { Collection } from '@/core/framework/support/Collection'

class QueryBuilder<TData extends DataSource, TModel extends Model<TData>> {
  private _conditions?: Partial<TData>
  private _relations: string[] = []
  private _limit?: number
  private _offset?: number
  private _orderBy?: { field: keyof TData; direction: 'asc' | 'desc' }

  public constructor(private modelClass: ModelConstructor<TData, TModel>) {}

  public where(conditions: Partial<TData>): this {
    this._conditions = { ...this._conditions, ...conditions }

    return this
  }

  public with(...relations: string[]): this {
    this._relations.push(...relations)

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

  public get(): Collection<TModel> {
    const ModelClass = this.modelClass as any
    let collection: Collection<TModel> = this._conditions ? ModelClass.where(this._conditions) : ModelClass.all()

    if (this._orderBy) {
      collection = collection.sortBy(this._orderBy.field as any, this._orderBy.direction)
    }

    if (this._offset !== undefined && this._offset > 0) {
      collection = collection.skip(this._offset)
    }

    if (this._limit !== undefined && this._limit > 0) {
      collection = collection.take(this._limit)
    }

    return collection
  }

  public paginate(
    page: number,
    perPage: number = 15
  ): {
    data: Collection<TModel>
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
    const collection: Collection<TModel> = this.limit(1).get()

    return collection.first() || null
  }

  public exists(): boolean {
    return this.limit(1).get().isNotEmpty()
  }

  public count(): number {
    const ModelClass = this.modelClass as any
    const collection: Collection<TModel> = this._conditions ? ModelClass.where(this._conditions) : ModelClass.all()

    return collection.count()
  }

  public pluck<TKey extends keyof TData>(field: TKey): TData[TKey][] {
    return this.get().pluck(field as any)
  }

  public toArray(): TModel[] {
    return this.get().toArray()
  }
}

export { QueryBuilder }
