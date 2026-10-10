import process from 'node:process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { Resources } from '@storage/database/resources'
import { cloudManifestPaths } from './lib/cloudManifest'
import {
  CLOUD_CACHE_CONTROL,
  contentTypeFor,
  copySourceFor,
  deletionVerdict,
  diffContent,
  etagMatchesMd5,
  headersUpToDate,
  isDryRun,
  isFolderMarker,
  listAllObjects,
  runConcurrent,
  type LocalFile,
  type RemoteObject
} from './lib/cloudSync'

/**
 * Синк бакета по манифесту облака: заливает новое и изменённое (MD5 против
 * ETag) с Cache-Control: no-cache, правит заголовки уже залитого копией в
 * себя, показывает лишнее в бакете.
 *
 * Запуск: npm run cloud:sync [-- --dry-run] [-- --delete]
 *
 * `--dry-run` — только план; `--delete` — плюс удаление объектов вне
 * манифеста (не после сбоев и не больше половины бакета). Ключи — в .env:
 * S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (без VITE_ — в сборку не попадают);
 * эндпоинт и бакет — VITE_S3_URL, VITE_FILE_BUCKET. Повторный запуск
 * доливает то, что не дошло
 */

const ROOT = 'storage/images/textures'
const REGION = 'ru-central1'
const HASH_CONCURRENCY = 4
const UPLOAD_CONCURRENCY = 4
const REQUEST_CONCURRENCY = 16
const dryRun = isDryRun(process.argv, process.env)
const deleteOrphans = process.argv.includes('--delete')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function mib(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} МиБ`
}

function totalSize(items: readonly { readonly size: number }[]): number {
  return items.reduce((sum, item) => sum + item.size, 0)
}

function httpStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
}

async function md5Of(file: string): Promise<string> {
  const hash = createHash('md5')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function requiredEnv(): { accessKeyId: string; secretAccessKey: string; endpoint: string; bucket: string } {
  if (existsSync('.env')) process.loadEnvFile('.env')
  const { S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, VITE_S3_URL, VITE_FILE_BUCKET } = process.env
  if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    fail('Нет ключей бакета — добавьте в .env строки:\n  S3_ACCESS_KEY_ID=<идентификатор ключа>\n  S3_SECRET_ACCESS_KEY=<секретный ключ>')
  }
  if (!VITE_S3_URL || !VITE_FILE_BUCKET) fail('Нет VITE_S3_URL или VITE_FILE_BUCKET в .env')
  return { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY, endpoint: VITE_S3_URL, bucket: VITE_FILE_BUCKET }
}

const { accessKeyId, secretAccessKey, endpoint, bucket } = requiredEnv()

// Манифест — до сети: незнакомое расширение или пропавший файл останавливают синк
const manifest = cloudManifestPaths(Resources)
try {
  for (const relative of manifest) contentTypeFor(relative)
} catch (error) {
  fail((error as Error).message)
}
const missing = manifest.filter((relative) => !existsSync(path.join(ROOT, relative)))
if (missing.length > 0) {
  fail(`Файлов манифеста нет на диске (${missing.length}) — синк остановлен:\n${missing.map((m) => `  ${m}`).join('\n')}`)
}

console.log(`манифест: ${manifest.length} файлов — считаю MD5…`)
const local: LocalFile[] = []
await runConcurrent(manifest, HASH_CONCURRENCY, async (relative) => {
  const file = path.join(ROOT, relative)
  local.push({ path: relative, size: (await stat(file)).size, md5: await md5Of(file) })
})
local.sort((a, b) => a.path.localeCompare(b.path))

const client = new S3Client({
  region: REGION,
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
  maxAttempts: 5,
  // CRC32 и aws-chunked новых SDK S3-совместимые хранилища иногда отвергают; целостность — свой Content-MD5
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED'
})

let remote: RemoteObject[]
try {
  remote = await listAllObjects(async (token) => {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }))
    return {
      objects: (page.Contents ?? []).flatMap((item) =>
        item.Key === undefined ? [] : [{ key: item.Key, size: item.Size ?? 0, etag: item.ETag }]
      ),
      nextToken: page.IsTruncated ? page.NextContinuationToken : undefined
    }
  })
} catch (error) {
  if (httpStatus(error) === 403) fail(`Бакет ${bucket}: ключ не принят или нет прав на список объектов (403)`)
  throw error
}

const diff = diffContent(local, remote)
const headerFixes: LocalFile[] = []
await runConcurrent(diff.matched, REQUEST_CONCURRENCY, async (file) => {
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: file.path }))
  if (!headersUpToDate(file.path, { cacheControl: head.CacheControl, contentType: head.ContentType })) headerFixes.push(file)
})
headerFixes.sort((a, b) => a.path.localeCompare(b.path))

const uploads = [...diff.uploadsNew, ...diff.uploadsChanged]
console.log(
  `план: залить ${uploads.length} (${mib(totalSize(uploads))}; новых ${diff.uploadsNew.length}, изменённых ${diff.uploadsChanged.length}), ` +
    `заголовки ${headerFixes.length}, на месте ${diff.matched.length - headerFixes.length}, ` +
    `лишних в бакете ${diff.orphans.length} (${mib(totalSize(diff.orphans))})`
)
for (const file of diff.uploadsNew) console.log(`  + ${file.path} ${mib(file.size)}`)
for (const file of diff.uploadsChanged) console.log(`  ~ ${file.path} ${mib(file.size)}`)
for (const object of diff.orphans) console.log(`  − ${object.key} ${mib(object.size)}`)
if (diff.orphans.length > 0 && !deleteOrphans) console.log('лишнее удаляется с -- --delete')
if (dryRun) process.exit(0)

const failures: string[] = []
const started = Date.now()
let uploaded = 0
let uploadedBytes = 0

await runConcurrent(uploads, UPLOAD_CONCURRENCY, async (file) => {
  try {
    const body = await readFile(path.join(ROOT, file.path))
    const md5 = createHash('md5').update(body).digest()
    const result = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: file.path,
        Body: body,
        ContentType: contentTypeFor(file.path),
        CacheControl: CLOUD_CACHE_CONTROL,
        ContentMD5: md5.toString('base64')
      })
    )
    if (!etagMatchesMd5(result.ETag, md5.toString('hex'))) throw new Error(`ETag ответа ${result.ETag ?? '—'} ≠ MD5 файла`)
    uploaded++
    uploadedBytes += body.byteLength
    console.log(`[${uploaded}/${uploads.length}] ${file.path} ${mib(body.byteLength)}`)
  } catch (error) {
    failures.push(`${file.path}: ${String(error)}`)
  }
})

let fixed = 0
await runConcurrent(headerFixes, REQUEST_CONCURRENCY, async (file) => {
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: file.path,
        CopySource: copySourceFor(bucket, file.path),
        MetadataDirective: 'REPLACE',
        ContentType: contentTypeFor(file.path),
        CacheControl: CLOUD_CACHE_CONTROL
      })
    )
    fixed++
  } catch (error) {
    failures.push(`${file.path} (заголовки): ${String(error)}`)
  }
})
if (headerFixes.length > 0) console.log(`заголовки: ${fixed}/${headerFixes.length}`)

let deleted = 0
if (deleteOrphans && diff.orphans.length > 0) {
  const objectCount = remote.filter((object) => !isFolderMarker(object.key)).length + diff.uploadsNew.length
  const verdict = deletionVerdict(diff.orphans.length, objectCount, failures.length > 0)
  if (!verdict.allowed) {
    console.error(`удаление: ${verdict.reason}`)
  } else {
    for (const object of diff.orphans) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.key }))
        deleted++
        console.log(`удалён ${object.key}`)
      } catch (error) {
        failures.push(`${object.key} (удаление): ${String(error)}`)
      }
    }
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(0)
console.log(`итог: залито ${uploaded} (${mib(uploadedBytes)}) за ${seconds} с, заголовков ${fixed}, удалено ${deleted}, сбоев ${failures.length}`)
if (failures.length > 0) {
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
