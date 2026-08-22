import path from 'node:path'

/** Путь на диске → путь БД: разделители ОС → `/`, срезается корень `root` (без хвостового слэша). */
export function dbPathFor(localPath: string, root: string): string {
  return localPath.split(path.sep).join('/').replace(`${root}/`, '')
}
