import { Collection } from '@/core/framework/support/Collection'
import { DataSource, Model } from '@/core/framework/Memoquent/Model'

class ModelCollection<TModel extends Model<any>> extends Collection<TModel> {
  public constructor(items: TModel[] = []) {
    super(items)
  }

  public find(id: number | string): TModel | undefined {
    return this.where('id', '===', id).first()
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

      if (children instanceof ModelCollection) {
        children.each((child): void | false => {
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

  protected override value(item: TModel, key: keyof TModel['attributes']): any {
    return item.getAttribute(key)
  }

  public toJSON(): any[] {
    return this.items.map((item: TModel) => item.toJSON())
  }

  public static fromData<TData extends DataSource, TModel extends Model<TData>>(
    data: TData[],
    modelClass: new (attributes?: Partial<TData>) => TModel
  ): ModelCollection<TModel> {
    const models: TModel[] = data.map((item: TData) => new modelClass(item))

    return new this(models)
  }
}

export { ModelCollection }
