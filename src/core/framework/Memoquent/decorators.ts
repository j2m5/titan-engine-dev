import 'reflect-metadata'
import { DataSource, Model, RelationConfig, RelationMetadata, RELATIONS_KEY } from '@/core/framework/Memoquent/Model.ts'

export function belongsTo<T extends DataSource>(
  modelFactory: () => new (attributes?: Partial<T>) => Model<T>,
  config: RelationConfig
) {
  return function (target: any, propertyKey: string): void {
    const relations: RelationMetadata[] = Reflect.getMetadata(RELATIONS_KEY, target.constructor) || []
    relations.push({
      type: 'belongsTo',
      modelFactory,
      config,
      propertyKey
    })
    Reflect.defineMetadata(RELATIONS_KEY, relations, target.constructor)
  }
}

export function hasOne<T extends DataSource>(
  modelFactory: () => new (attributes?: Partial<T>) => Model<T>,
  config: RelationConfig
) {
  return function (target: any, propertyKey: string): void {
    const relations: RelationMetadata[] = Reflect.getMetadata(RELATIONS_KEY, target.constructor) || []
    relations.push({
      type: 'hasOne',
      modelFactory,
      config,
      propertyKey
    })
    Reflect.defineMetadata(RELATIONS_KEY, relations, target.constructor)
  }
}

export function hasMany<T extends DataSource>(
  modelFactory: () => new (attributes?: Partial<T>) => Model<T>,
  config: RelationConfig
) {
  return function (target: any, propertyKey: string): void {
    const relations: RelationMetadata[] = Reflect.getMetadata(RELATIONS_KEY, target.constructor) || []
    relations.push({
      type: 'hasMany',
      modelFactory,
      config,
      propertyKey
    })
    Reflect.defineMetadata(RELATIONS_KEY, relations, target.constructor)
  }
}
