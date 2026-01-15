import { DataSource, Model } from '@/core/framework/Memoquent/Model'
import { QueryBuilder } from '@/core/framework/Memoquent/QueryBuilder'

interface Scope<TData extends DataSource, TModel extends Model<TData>> {
  apply(builder: QueryBuilder<TData, TModel>): void
}

export type { Scope }
