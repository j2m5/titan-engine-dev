import 'reflect-metadata'
import { getData } from '@/config/app'
import { LazyRelationProxy } from '@/core/framework/Memoquent/LazyRelationProxy'
import { QueryBuilder } from '@/core/framework/Memoquent/QueryBuilder'
import { Collection } from '@/core/framework/Memoquent/Collection'

export type Identity = Record<string, number>
export type DataSource = Record<string, any>

export interface RelationConfig {
  foreignKey: keyof Identity
  ownerKey?: keyof Identity
}

export type RelationType = 'belongsTo' | 'hasOne' | 'hasMany'

export const RELATIONS_KEY = Symbol('relations')

export interface RelationMetadata {
  type: RelationType
  modelFactory: () => new (attributes?: any) => Model<any>
  config: RelationConfig
  propertyKey: string
}

export interface ModelConstructor<TData extends DataSource, TModel extends Model<TData>> {
  new (attributes?: Partial<TData>): TModel
}

abstract class Model<TData extends DataSource = DataSource> {
  protected abstract table: string
  public primaryKey: keyof Identity = 'id'
  public attributes: Partial<TData>

  private _relationCache: Map<string, any> = new Map<string, any>()
  private _relationProxies: Map<string, LazyRelationProxy<any>> = new Map<string, LazyRelationProxy<any>>()

  public constructor(attributes: Partial<TData> = {}) {
    this.attributes = attributes
    this.setupRelations()
  }

  public get source(): TData[] {
    return getData(this.table)
  }

  private setupRelations(): void {
    const relations: RelationMetadata[] = Reflect.getMetadata(RELATIONS_KEY, this.constructor) || []

    relations.forEach((relation: RelationMetadata): void => {
      const proxy: LazyRelationProxy<any> = new LazyRelationProxy(
        () => this.loadRelationData(relation),
        this._relationCache,
        relation.propertyKey
      )

      this._relationProxies.set(relation.propertyKey, proxy)

      if (relation.propertyKey in this) {
        delete (this as any)[relation.propertyKey]
      }

      Object.defineProperty(this, relation.propertyKey, {
        get: () => {
          return proxy.load()
        },
        enumerable: true,
        configurable: true
      })
    })
  }

  private loadRelationData(relation: RelationMetadata): any {
    const ModelClass: { new (attributes?: any): Model<any> } = relation.modelFactory()

    switch (relation.type) {
      case 'belongsTo':
        return this.belongsTo(ModelClass, relation.config)
      case 'hasOne':
        return this.hasOne(ModelClass, relation.config)
      case 'hasMany':
        return this.hasMany(ModelClass, relation.config)
      default:
        throw new Error(`Unknown relation type: ${relation.type}`)
    }
  }

  protected hasMany<TRelated extends DataSource>(
    modelClass: new (attributes?: Partial<TRelated>) => Model<TRelated>,
    config: RelationConfig
  ): Collection<Model<TRelated>> {
    const relatedInstance: Model<TRelated> = new modelClass()
    const ownerKey: string = config.ownerKey || this.primaryKey
    const ownerValue: TData[string] | undefined = this.attributes[ownerKey]

    if (ownerValue === undefined) {
      return new Collection([])
    }

    const models: Model<TRelated>[] = relatedInstance.source
      .filter((item: TRelated): boolean => item[config.foreignKey] === ownerValue)
      .map((item: TRelated) => new modelClass(item))

    return new Collection(models)
  }

  protected hasOne<TRelated extends DataSource>(
    modelClass: new (attributes?: Partial<TRelated>) => Model<TRelated>,
    config: RelationConfig
  ): Model<TRelated> | null {
    const results: Collection<Model<TRelated>> = this.hasMany(modelClass, config)

    return results.first() || null
  }

  protected belongsTo<TRelated extends DataSource>(
    modelClass: new (attributes?: Partial<TRelated>) => Model<TRelated>,
    config: RelationConfig
  ): Model<TRelated> | null {
    const relatedInstance: Model<TRelated> = new modelClass()
    const ownerKey: string = config.ownerKey || relatedInstance.primaryKey
    const foreignValue: TData[string] | undefined = this.attributes[config.foreignKey]

    if (foreignValue === undefined) {
      return null
    }

    const item: TRelated | undefined = relatedInstance.source.find(
      (item: TRelated): boolean => item[ownerKey] === foreignValue
    )

    return item ? new modelClass(item) : null
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
    const item: TData | undefined = instance.source.find((item: TData): boolean => item[instance.primaryKey] === id)

    return item ? new this(item) : null
  }

  public static where<TData extends DataSource, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>,
    conditions: Partial<TData>
  ): Collection<TModel> {
    const instance: TModel = new this()
    const items: TData[] = instance.source.filter((item: TData) =>
      Object.entries(conditions).every(([key, value]): boolean => item[key] === value)
    )

    return new Collection(items.map((item: TData) => new this(item)))
  }

  public static all<TData extends DataSource, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>
  ): Collection<TModel> {
    const instance: TModel = new this()

    return new Collection(instance.source.map((item: TData) => new this(item)))
  }

  public static first<TData extends DataSource, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>,
    conditions?: Partial<TData>
  ): TModel | null {
    const instance: TModel = new this()
    const items: TData[] = conditions
      ? instance.source.filter((item: TData) =>
          Object.entries(conditions).every(([key, value]): boolean => item[key] === value)
        )
      : instance.source

    return items.length > 0 ? new this(items[0]) : null
  }

  public static withRelations<TData extends DataSource, TModel extends Model<TData>>(
    this: ModelConstructor<TData, TModel>,
    ...relations: string[]
  ): Collection<TModel> {
    const instance: TModel = new this()

    return new Collection(instance.source.map((item: TData) => new this(item).with(...relations)))
  }

  public isRelationLoaded(relationName: string): boolean {
    return this._relationCache.has(relationName)
  }

  public hasRelation(relation: string): boolean {
    return this.getRelations().some((r: RelationMetadata): boolean => r.propertyKey === relation)
  }

  public getRelations(): RelationMetadata[] {
    return Reflect.getMetadata(RELATIONS_KEY, this.constructor) || []
  }

  public getLoadedRelations(): string[] {
    return Array.from(this._relationCache.keys())
  }

  public clearRelationCache(relation?: string): void {
    if (relation) {
      this._relationCache.delete(relation)
    } else {
      this._relationCache.clear()
    }
  }

  public with(...relations: string[]): this {
    relations.forEach((relation: string): void => {
      const proxy: LazyRelationProxy<any> | undefined = this._relationProxies.get(relation)
      if (proxy) {
        proxy.load()
      }
    })

    return this
  }

  public withAll(): this {
    const relations: RelationMetadata[] = this.getRelations()
    relations.forEach((relation: RelationMetadata): void => {
      const proxy: LazyRelationProxy<any> | undefined = this._relationProxies.get(relation.propertyKey)
      if (proxy) {
        proxy.load()
      }
    })

    return this
  }

  public fill(attributes: Partial<TData>): this {
    this.attributes = { ...this.attributes, ...attributes }

    this.clearRelationCache()

    return this
  }

  public getAttribute<TKey extends keyof TData>(key: TKey, defaultValue: any = '-'): TData[TKey] | any {
    return this.attributes[key] || defaultValue
  }

  public setAttribute<TKey extends keyof TData>(key: TKey, value: TData[TKey]): this {
    this.attributes[key] = value

    const relations: RelationMetadata[] = this.getRelations()

    const affectedRelations: RelationMetadata[] = relations.filter(
      (r: RelationMetadata) => r.config.foreignKey === key || r.config.ownerKey === key
    )
    affectedRelations.forEach((r: RelationMetadata) => this.clearRelationCache(r.propertyKey))

    return this
  }

  public clone(): this {
    const Constructor: ModelConstructor<TData, this> = this.constructor as ModelConstructor<TData, this>
    const cloned = new Constructor({ ...this.attributes })

    this._relationCache.forEach((value, key): void => {
      cloned._relationCache.set(key, value)
    })

    return cloned
  }

  public toJSON(): Record<string, any> {
    return {
      ...this.attributes,
      ...Object.fromEntries(
        Array.from(this._relationCache.entries()).map(([key, value]): [string, any] => {
          if (Array.isArray(value)) {
            return [key, value.map((v) => (v instanceof Model ? v.toJSON() : v))]
          }
          return [key, value instanceof Model ? value.toJSON() : value]
        })
      )
    }
  }
}

export { Model }
