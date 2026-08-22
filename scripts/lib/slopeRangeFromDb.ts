import type { IResource } from '@/core/models/types'
import { isValidSlopeRange } from '@/core/terrain/slopeMapFormat'

/** Диапазон slope-карты из строки ресурса по пути; отсутствие — ошибка (не подгонять молча). */
export function slopeRangeForPath(path: string, resources: readonly IResource[]): number {
  const row = resources.find((r) => r.resourceType === 'slope' && r.path === path)
  if (!row) throw new Error(`slope-ресурс не найден в БД: ${path}`)
  if (row.slopeRange === undefined) {
    throw new Error(`у ${path} не объявлен slopeRange — запустить rebuild-slopemaps --recommend и перенести значения в resources.ts`)
  }
  if (!isValidSlopeRange(row.slopeRange)) throw new Error(`slopeRange у ${path} вне сетки: ${row.slopeRange}`)
  return row.slopeRange
}
