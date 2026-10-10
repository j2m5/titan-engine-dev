/**
 * Синк бакета по манифесту облака (`npm run cloud:sync`), чистая часть:
 * сравнение локальных файлов с объектами бакета, заголовки, предохранитель
 * удаления. Диск и сеть — в scripts/cloud-sync.ts
 */

/** Браузер хранит копию и ревалидирует по ETag: неизменённый файл — 304 без тела */
export const CLOUD_CACHE_CONTROL = 'no-cache'

const OCTET_STREAM = 'application/octet-stream'

/** Content-Type по расширению; новое расширение в манифесте — пополнить */
const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['raw', OCTET_STREAM],
  ['aux', OCTET_STREAM],
  ['bin', OCTET_STREAM],
  ['dat', OCTET_STREAM]
])

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const extension = dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : ''
  const type = CONTENT_TYPES.get(extension)
  if (type === undefined) {
    throw new Error(`${path}: нет Content-Type для расширения «${extension}» — пополнить CONTENT_TYPES в scripts/lib/cloudSync.ts`)
  }
  return type
}

/** ETag = MD5 содержимого только у заливки одним запросом; multipart («-N») несравним */
export function etagMatchesMd5(etag: string | undefined, md5Hex: string): boolean {
  if (etag === undefined) return false
  const value = etag.replace(/"/g, '').toLowerCase()
  return !value.includes('-') && value === md5Hex.toLowerCase()
}

export interface LocalFile {
  /** От корня текстур = ключ в бакете */
  readonly path: string
  readonly size: number
  /** hex */
  readonly md5: string
}

export interface RemoteObject {
  readonly key: string
  readonly size: number
  readonly etag: string | undefined
}

export interface RemoteHeaders {
  readonly cacheControl: string | undefined
  readonly contentType: string | undefined
}

export interface ContentDiff {
  /** Объекта нет */
  readonly uploadsNew: readonly LocalFile[]
  /** Размер или ETag разошлись с файлом */
  readonly uploadsChanged: readonly LocalFile[]
  /** Содержимое совпало — осталось сверить заголовки */
  readonly matched: readonly LocalFile[]
  /** Объекты вне манифеста, кроме «папок» */
  readonly orphans: readonly RemoteObject[]
}

/** «Папка» GUI-клиента (ключ на «/»): данных нет, лишним не считается */
export function isFolderMarker(key: string): boolean {
  return key.endsWith('/')
}

export function diffContent(local: readonly LocalFile[], remote: readonly RemoteObject[]): ContentDiff {
  const byKey = new Map(remote.map((object) => [object.key, object]))
  const manifest = new Set(local.map((file) => file.path))
  const uploadsNew: LocalFile[] = []
  const uploadsChanged: LocalFile[] = []
  const matched: LocalFile[] = []

  for (const file of local) {
    const object = byKey.get(file.path)
    if (object === undefined) uploadsNew.push(file)
    else if (object.size !== file.size || !etagMatchesMd5(object.etag, file.md5)) uploadsChanged.push(file)
    else matched.push(file)
  }

  const orphans = remote.filter((object) => !manifest.has(object.key) && !isFolderMarker(object.key))

  return { uploadsNew, uploadsChanged, matched, orphans }
}

/** Заголовки объекта = те, что поставила бы заливка */
export function headersUpToDate(path: string, headers: RemoteHeaders): boolean {
  return headers.cacheControl === CLOUD_CACHE_CONTROL && headers.contentType === contentTypeFor(path)
}

export type DeletionVerdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

/**
 * Удаление лишнего: не после сбоев (не терять то, чему нет замены) и не
 * больше половины объектов (сломанный манифест снёс бы демо)
 */
export function deletionVerdict(orphanCount: number, objectCount: number, hadFailures: boolean): DeletionVerdict {
  if (hadFailures) return { allowed: false, reason: 'в прогоне были сбои — удаление пропущено, сначала повторить синк' }
  if (orphanCount * 2 > objectCount) {
    return {
      allowed: false,
      reason: `${orphanCount} из ${objectCount} объектов — больше половины бакета: похоже на сломанный манифест, такую чистку — руками`
    }
  }
  return { allowed: true }
}

/** CopySource копии в себя: сегменты пути кодируются по отдельности */
export function copySourceFor(bucket: string, key: string): string {
  return [bucket, ...key.split('/')].map(encodeURIComponent).join('/')
}

export interface ObjectPage {
  readonly objects: readonly RemoteObject[]
  /** Нет — последняя страница */
  readonly nextToken: string | undefined
}

/** Листинг бакета целиком: страница — до 1000 объектов */
export async function listAllObjects(fetchPage: (token: string | undefined) => Promise<ObjectPage>): Promise<RemoteObject[]> {
  const objects: RemoteObject[] = []
  let token: string | undefined
  do {
    const page = await fetchPage(token)
    objects.push(...page.objects)
    token = page.nextToken
  } while (token !== undefined)
  return objects
}

/** Пул из limit задач; порядок завершения произвольный */
export async function runConcurrent<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) await task(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
