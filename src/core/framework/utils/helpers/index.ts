import { database } from '@/config/database'

export function db<TData>(table: string): TData[] {
  return database.get(table) as TData[]
}
