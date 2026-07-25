import { Model } from '@/core/framework/Memoquent/Model'
import { QueryBuilder } from '@/core/framework/Memoquent/QueryBuilder'

interface Scope<TData extends object, TModel extends Model<TData>> {
  apply(builder: QueryBuilder<TData, TModel>): void
}

export type { Scope }
