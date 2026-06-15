import { database } from '@/config/database'
import { QueryBuilder } from '@/core/framework/Memoquent/QueryBuilder'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'
import { Scope } from '@/core/framework/Memoquent/Scope'

export type Identity = Record<string, number>
export type DataSource = Record<string, any>

export interface RelationConfig<T = Identity> {
  foreignKey: keyof T
  ownerKey?: keyof T
  relatedKey?: keyof T
}

export interface ModelConstructor<TData extends DataSource, TModel extends Model<TData>> {
  new (attributes?: Partial<TData>): TModel
}

abstract class Model<TData extends DataSource = DataSource> {
  protected abstract table: string
  protected primaryKey: keyof Identity = 'id'
  public attributes: Partial<TData> = {}

  protected static globalScopes: Map<string, Scope<any, any>> = new Map()

  public constructor(attributes: Partial<TData> = {}) {
    this.fill(attributes)
  }

  public static addGlobalScope(name: string, scope: Scope<any, any>): void {
    if (!Object.prototype.hasOwnProperty.call(this, 'globalScopes')) {
      this.globalScopes = new Map()
    }

    this.globalScopes.set(name, scope)
  }

  public static getGlobalScopes(): Map<string, Scope<any, any>> {
    return this.globalScopes
  }

  public source(): TData[] {
    return database.get(this.table) as TData[]
  }

  protected hasMany<TRelatedData extends DataSource, TRelatedModel extends Model<TRelatedData>>(
    modelClass: ModelConstructor<TRelatedData, TRelatedModel>,
    config: Pick<RelationConfig, 'foreignKey' | 'ownerKey'>
  ): ModelCollection<TRelatedModel> {
    const relatedInstance: TRelatedModel = new modelClass()
    const ownerKey: string = config.ownerKey || this.primaryKey
    const ownerValue: TData[string] | undefined = this.attributes[ownerKey]

    if (ownerValue === undefined) {
      return new ModelCollection<TRelatedModel>([])
    }

    const models: TRelatedModel[] = relatedInstance
      .source()
      .filter((item: TRelatedData): boolean => item[config.foreignKey] === ownerValue)
      .map((item: TRelatedData) => new modelClass(item))

    return new ModelCollection<TRelatedModel>(models)
  }

  protected hasOne<TRelatedData extends DataSource, TRelatedModel extends Model<TRelatedData>>(
    modelClass: ModelConstructor<TRelatedData, TRelatedModel>,
    config: Pick<RelationConfig, 'foreignKey' | 'ownerKey'>
  ): TRelatedModel | null {
    return this.hasMany(modelClass, config).first() || null
  }

  protected belongsTo<TRelatedData extends DataSource, TRelatedModel extends Model<TRelatedData>>(
    modelClass: ModelConstructor<TRelatedData, TRelatedModel>,
    config: Pick<RelationConfig, 'foreignKey' | 'ownerKey'>
  ): TRelatedModel | null {
    const relatedInstance: TRelatedModel = new modelClass()
    const ownerKey: string = config.ownerKey || relatedInstance.primaryKey
    const foreignValue: TData[string] | undefined = this.attributes[config.foreignKey]

    if (foreignValue === undefined) {
      return null
    }

    const item: TRelatedData | undefined = relatedInstance
      .source()
      .find((item: TRelatedData): boolean => item[ownerKey] === foreignValue)

    return item ? new modelClass(item) : null
  }

  protected belongsToMany<
    TPivot extends DataSource,
    TPivotModel extends Model<TPivot>,
    TRelatedData extends DataSource,
    TRelatedModel extends Model<TRelatedData>
  >(
    relatedModel: ModelConstructor<TRelatedData, TRelatedModel>,
    pivotModel: ModelConstructor<TPivot, TPivotModel>,
    config: Pick<RelationConfig<TPivot>, 'foreignKey' | 'relatedKey'>
  ): ModelCollection<TRelatedModel> {
    const ownerKey: string = this.primaryKey
    const ownerValue: TData[string] | undefined = this.attributes[ownerKey]

    if (ownerValue === undefined) {
      return new ModelCollection<TRelatedModel>([])
    }

    const pivotInstance: TPivotModel = new pivotModel()

    const relatedIds: TPivot[keyof TPivot][] = pivotInstance
      .source()
      .filter((p: TPivot): boolean => p[config.foreignKey] === ownerValue)
      .map((p: TPivot) => p[config.relatedKey!])

    if (relatedIds.length === 0) {
      return new ModelCollection<TRelatedModel>([])
    }

    const relatedInstance: TRelatedModel = new relatedModel()

    const models: TRelatedModel[] = relatedInstance
      .source()
      .filter((item: TRelatedData) => relatedIds.includes(item[relatedInstance.primaryKey]))
      .map((item: TRelatedData) => new relatedModel(item))

    return new ModelCollection<TRelatedModel>(models)
  }

  public static query<TData extends DataSource, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>
  ): QueryBuilder<TData, TModel> {
    return new QueryBuilder(this)
  }

  public static find<TData extends DataSource, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>,
    id: number | string
  ): TModel | null {
    const instance: TModel = new this()
    const item: TData | undefined = instance.source().find((item: TData): boolean => item[instance.primaryKey] === id)

    return item ? new this(item) : null
  }

  public static where<TData extends DataSource, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>,
    conditions: Partial<TData>
  ): ModelCollection<TModel> {
    const instance: TModel = new this()
    const items: TData[] = instance
      .source()
      .filter((item: TData) => Object.entries(conditions).every(([key, value]): boolean => item[key] === value))

    return new ModelCollection(items.map((item: TData) => new this(item)))
  }

  public static all<TData extends DataSource, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>
  ): ModelCollection<TModel> {
    const instance: TModel = new this()

    return new ModelCollection(instance.source().map((item: TData) => new this(item)))
  }

  public static first<TData extends DataSource, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>,
    conditions?: Partial<TData>
  ): TModel | null {
    const instance: TModel = new this()
    const items: TData[] = conditions
      ? instance
          .source()
          .filter((item: TData) => Object.entries(conditions).every(([key, value]): boolean => item[key] === value))
      : instance.source()

    return items.length > 0 ? new this(items[0]) : null
  }

  public fill(attributes: Partial<TData>): this {
    this.attributes = { ...this.attributes, ...attributes }

    return this
  }

  public is(model: Model<any> | null | undefined): boolean {
    if (!model) return false

    return (
      this.constructor === model.constructor && this.getKey() === model.getKey() && this.getTable() === model.getTable()
    )
  }

  public isNot(model: Model<any> | null | undefined): boolean {
    return !this.is(model)
  }

  public only<K extends keyof TData>(keys: K[]): Pick<TData, K> {
    return Object.fromEntries(keys.map((k: K) => [k, this.attributes[k]])) as Pick<TData, K>
  }

  public except<K extends keyof TData>(keys: K[]): Partial<TData> {
    const result: Partial<TData> = { ...this.attributes }
    keys.forEach((k: K) => delete result[k])

    return result
  }

  public getAttribute<TKey extends keyof TData>(key: TKey, defaultValue: any = '-'): TData[TKey] | any {
    return this.attributes[key] || defaultValue
  }

  public setAttribute<TKey extends keyof TData>(key: TKey, value: TData[TKey]): this {
    this.attributes[key] = value

    return this
  }

  public getKeyName(): keyof Identity {
    return this.primaryKey
  }

  public getKey(): number | undefined {
    return this.attributes[this.primaryKey]
  }

  public getTable(): string {
    return this.table
  }

  public clone(): this {
    const Constructor: ModelConstructor<TData, this> = this.constructor as ModelConstructor<TData, this>

    return new Constructor({ ...this.attributes })
  }

  public toJSON(): Record<string, any> {
    return { ...this.attributes }
  }
}

export { Model }
