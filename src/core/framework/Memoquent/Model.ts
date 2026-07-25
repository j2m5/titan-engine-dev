import { database } from '@/config/database'
import { QueryBuilder } from '@/core/framework/Memoquent/QueryBuilder'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'
import { Scope } from '@/core/framework/Memoquent/Scope'

export type DataSource = Record<string, unknown>

/**
 * Домены ключей у разных видов связей РАЗЛИЧАЮТСЯ, поэтому конфиги раздельные.
 * У belongsTo foreignKey живёт на ЭТОЙ модели, а ownerKey — на связанной,
 * то есть наоборот к hasMany. Попытка описать оба одним типом и вынуждала
 * типизировать ключ как string.
 */
export interface HasManyConfig<TData extends object, TRelatedData extends object> {
  foreignKey: keyof TRelatedData
  ownerKey?: keyof TData
}

export interface BelongsToConfig<TData extends object, TRelatedData extends object> {
  foreignKey: keyof TData
  ownerKey?: keyof TRelatedData
}

export interface BelongsToManyConfig<TPivot extends object> {
  foreignKey: keyof TPivot
  relatedKey: keyof TPivot
}

export interface ModelConstructor<TData extends object, TModel extends Model<TData>> {
  new (attributes?: Partial<TData>): TModel
  /**
   * Статические члены в TS не могут ссылаться на параметры типа класса,
   * поэтому карта скоупов типизируется по нижней границе
   * Scope<object, Model<object>>. Тип совпадает с типом поля globalScopes
   * буквально — на присваиваемость конкретных Scope<IActor, Actor> к границе
   * здесь рассчитывать нельзя, её нет (см. комментарий к addGlobalScope).
   */
  getGlobalScopes(): Map<string, Scope<object, Model<object>>>
}

abstract class Model<TData extends object = DataSource> {
  protected abstract table: string
  protected primaryKey: string = 'id'
  public attributes: Partial<TData> = {}

  protected static globalScopes: Map<string, Scope<object, Model<object>>> = new Map()

  public constructor(attributes: Partial<TData> = {}) {
    this.fill(attributes)
  }

  /**
   * Параметр обобщённый, а не Scope<object, Model<object>>: Scope на практике
   * инвариантен по TModel (RelationKeys<Model<object>> вырождается в never,
   * поэтому бивариантность apply не спасает), и конкретный Scope<IActor, Actor>
   * нижней границе не удовлетворяет. Переход через unknown при записи в карту —
   * та же вынужденная мера, что и в QueryBuilder.applyGlobalScopes.
   */
  public static addGlobalScope<TData extends object, TModel extends Model<TData>>(
    name: string,
    scope: Scope<TData, TModel>
  ): void {
    if (!Object.prototype.hasOwnProperty.call(this, 'globalScopes')) {
      this.globalScopes = new Map()
    }

    this.globalScopes.set(name, scope as unknown as Scope<object, Model<object>>)
  }

  public static getGlobalScopes(): Map<string, Scope<object, Model<object>>> {
    return this.globalScopes
  }

  public source(): TData[] {
    return database.get(this.table) as TData[]
  }

  protected hasMany<TRelatedData extends object, TRelatedModel extends Model<TRelatedData>>(
    modelClass: ModelConstructor<TRelatedData, TRelatedModel>,
    config: HasManyConfig<TData, TRelatedData>
  ): ModelCollection<TRelatedModel> {
    const relatedInstance: TRelatedModel = new modelClass()
    const ownerKey = (config.ownerKey ?? this.primaryKey) as keyof TData
    const ownerValue: TData[keyof TData] | undefined = this.attributes[ownerKey]

    if (ownerValue === undefined) {
      return new ModelCollection<TRelatedModel>([])
    }

    const models: TRelatedModel[] = relatedInstance
      .source()
      .filter((item: TRelatedData): boolean => (item[config.foreignKey] as unknown) === (ownerValue as unknown))
      .map((item: TRelatedData) => new modelClass(item))

    return new ModelCollection<TRelatedModel>(models)
  }

  protected hasOne<TRelatedData extends object, TRelatedModel extends Model<TRelatedData>>(
    modelClass: ModelConstructor<TRelatedData, TRelatedModel>,
    config: HasManyConfig<TData, TRelatedData>
  ): TRelatedModel | null {
    return this.hasMany(modelClass, config).first() ?? null
  }

  protected belongsTo<TRelatedData extends object, TRelatedModel extends Model<TRelatedData>>(
    modelClass: ModelConstructor<TRelatedData, TRelatedModel>,
    config: BelongsToConfig<TData, TRelatedData>
  ): TRelatedModel | null {
    const relatedInstance: TRelatedModel = new modelClass()
    const ownerKey = (config.ownerKey ?? relatedInstance.primaryKey) as keyof TRelatedData
    const foreignValue: TData[keyof TData] | undefined = this.attributes[config.foreignKey]

    if (foreignValue === undefined || foreignValue === null) {
      return null
    }

    const item: TRelatedData | undefined = relatedInstance
      .source()
      .find((row: TRelatedData): boolean => (row[ownerKey] as unknown) === (foreignValue as unknown))

    return item ? new modelClass(item) : null
  }

  protected belongsToMany<
    TPivot extends object,
    TPivotModel extends Model<TPivot>,
    TRelatedData extends object,
    TRelatedModel extends Model<TRelatedData>
  >(
    relatedModel: ModelConstructor<TRelatedData, TRelatedModel>,
    pivotModel: ModelConstructor<TPivot, TPivotModel>,
    config: BelongsToManyConfig<TPivot>
  ): ModelCollection<TRelatedModel> {
    const ownerValue: TData[keyof TData] | undefined = this.attributes[this.primaryKey as keyof TData]

    if (ownerValue === undefined) {
      return new ModelCollection<TRelatedModel>([])
    }

    const pivotInstance: TPivotModel = new pivotModel()

    const relatedIds: unknown[] = pivotInstance
      .source()
      .filter((p: TPivot): boolean => (p[config.foreignKey] as unknown) === (ownerValue as unknown))
      .map((p: TPivot) => p[config.relatedKey] as unknown)

    if (relatedIds.length === 0) {
      return new ModelCollection<TRelatedModel>([])
    }

    const relatedInstance: TRelatedModel = new relatedModel()
    const relatedPrimaryKey = relatedInstance.primaryKey as keyof TRelatedData

    const models: TRelatedModel[] = relatedInstance
      .source()
      .filter((item: TRelatedData) => relatedIds.includes(item[relatedPrimaryKey] as unknown))
      .map((item: TRelatedData) => new relatedModel(item))

    return new ModelCollection<TRelatedModel>(models)
  }

  public static query<TData extends object, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>
  ): QueryBuilder<TData, TModel> {
    return new QueryBuilder(this)
  }

  public static find<TData extends object, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>,
    id: number | string
  ): TModel | null {
    const instance: TModel = new this()
    const item: TData | undefined = instance
      .source()
      .find((item: TData): boolean => item[instance.primaryKey as keyof TData] === id)

    return item ? new this(item) : null
  }

  public static where<TData extends object, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>,
    conditions: Partial<TData>
  ): ModelCollection<TModel> {
    const instance: TModel = new this()
    const items: TData[] = instance
      .source()
      .filter((item: TData) =>
        Object.entries(conditions).every(([key, value]): boolean => item[key as keyof TData] === value)
      )

    return new ModelCollection(items.map((item: TData) => new this(item)))
  }

  public static all<TData extends object, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>
  ): ModelCollection<TModel> {
    const instance: TModel = new this()

    return new ModelCollection(instance.source().map((item: TData) => new this(item)))
  }

  public static first<TData extends object, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>,
    conditions?: Partial<TData>
  ): TModel | null {
    const instance: TModel = new this()
    const items: TData[] = conditions
      ? instance
          .source()
          .filter((item: TData) =>
            Object.entries(conditions).every(([key, value]): boolean => item[key as keyof TData] === value)
          )
      : instance.source()

    return items.length > 0 ? new this(items[0]) : null
  }

  public fill(attributes: Partial<TData>): this {
    this.attributes = { ...this.attributes, ...attributes }

    return this
  }

  public is(model: Model<object> | null | undefined): boolean {
    if (!model) return false

    return (
      this.constructor === model.constructor && this.getKey() === model.getKey() && this.getTable() === model.getTable()
    )
  }

  public isNot(model: Model<object> | null | undefined): boolean {
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

  public getKeyName(): string {
    return this.primaryKey
  }

  public getKey(): unknown {
    return this.attributes[this.primaryKey as keyof TData]
  }

  public getTable(): string {
    return this.table
  }

  public clone(): this {
    const Constructor: ModelConstructor<TData, this> = this.constructor as ModelConstructor<TData, this>

    return new Constructor({ ...this.attributes })
  }

  public toJSON(): Partial<TData> {
    return { ...this.attributes }
  }
}

export { Model }
