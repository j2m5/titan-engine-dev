import { Collection } from '@/core/framework/support/Collection'
import { Model } from '@/core/framework/Memoquent/Model'

/**
 * Извлекает форму данных модели. Позволяет ModelCollection остаться
 * одноместным (ModelCollection<Actor>), но индексировать ключи IActor,
 * а не ключи самого класса Actor.
 */
export type AttributesOf<TModel> = TModel extends Model<infer TData> ? TData : never

class ModelCollection<TModel extends Model<object>> extends Collection<TModel, AttributesOf<TModel>> {
  public constructor(items: TModel[] = []) {
    super(items)
  }

  public find(id: number | string): TModel | undefined {
    // 'id' — жестко зашитое имя первичного ключа: из TModel оно не выводится,
    // поэтому оба каста локальны и неизбежны
    return this.where(
      'id' as keyof AttributesOf<TModel>,
      id as AttributesOf<TModel>[keyof AttributesOf<TModel>]
    ).first()
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

      const children = item[childrenRelation]

      if (children instanceof ModelCollection) {
        children.each((child: TModel): void | false => {
          const childResult: void | false = traverse(child, depth + 1, item)

          return childResult === false ? false : undefined
        })
      }
    }

    this.items.forEach((item: TModel) => traverse(item))

    return this
  }

  public expand<TRelation extends keyof TModel>(childrenRelation: TRelation = 'children' as TRelation): this {
    const flattened: TModel[] = []

    this.eachRecursive((item: TModel): void => {
      flattened.push(item)
    }, childrenRelation)

    return this.instance(flattened)
  }

  protected override value<K extends keyof AttributesOf<TModel>>(
    item: TModel,
    key: K
  ): AttributesOf<TModel>[K] | undefined {
    // TModel сужен до Model<object>, поэтому связь TModel <-> AttributesOf<TModel>
    // компилятору недоступна: переход через unknown локален и безопасен по построению
    return (item as unknown as Model<AttributesOf<TModel>>).getAttribute(key)
  }

  public toJSON(): Partial<AttributesOf<TModel>>[] {
    return this.items.map((item: TModel) => item.toJSON() as Partial<AttributesOf<TModel>>)
  }

  public static fromData<TData extends object, TModel extends Model<TData>>(
    data: TData[],
    modelClass: new (attributes?: Partial<TData>) => TModel
  ): ModelCollection<TModel> {
    const models: TModel[] = data.map((item: TData) => new modelClass(item))

    return new this(models)
  }
}

export { ModelCollection }
