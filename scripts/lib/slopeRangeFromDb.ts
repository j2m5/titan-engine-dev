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

/**
 * Диапазоны ВСЕХ карт разом, пред-пасс перед записью файлов: первая же карта
 * без объявленного slopeRange останавливает всех — без него запись успела бы
 * перезаписать часть набора до падения на более поздней карте (полупересобранный
 * набор). Бросает как slopeRangeForPath, ничего не пишет.
 */
export function resolveSlopeRanges(
  jobs: readonly { slopePath: string }[],
  resources: readonly IResource[]
): Map<string, number> {
  const rangeByPath = new Map<string, number>()
  for (const job of jobs) {
    rangeByPath.set(job.slopePath, slopeRangeForPath(job.slopePath, resources))
  }
  return rangeByPath
}
