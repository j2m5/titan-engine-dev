import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Dev-only транспорт для редактора данных.
 *
 * Принимает POST /__db/save с телом { files: [{ path, content }] }
 *
 * Пишет TS-исходники, которые импортирует приложение, — значит, чужой запрос
 * исполнил бы свой код в dev-вкладке. Поэтому:
 *  - только Content-Type application/json: с ним кросс-доменный fetch
 *    обязан пройти CORS-префлайт, «простой» text/plain-запрос сюда не попадёт;
 *  - Origin, если браузер его прислал, обязан совпадать с хостом самого
 *    dev-сервера (без Origin — не браузер: скрипт, curl). Подмену Host через
 *    DNS rebinding отсекает сам Vite: его проверка allowedHosts стоит в цепочке
 *    раньше middleware плагинов.
 * При ошибке в работающем процессе восстанавливает предыдущие файлы из резервных копий.
 * Это не атомарная транзакция при падении процесса.
 */

interface SaveFile {
  path: string
  content: string
}

interface PluginOptions {
  /** корень, внутрь которого (и только) разрешена запись; относительно cwd */
  writableRoot?: string
  /** endpoint */
  route?: string
}

interface PreparedFile {
  resolved: string
  temp: string
  backup?: string
  replaced: boolean
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** In-process batch recovery only; process crashes and concurrent external writers are not atomic. */
function saveBatch(targets: Array<{ file: SaveFile; resolved: string }>, writableRoot: string): void {
  if (targets.length === 0) return
  // mkdtemp owns an exclusive namespace: another request's recovery data is never overwritten.
  fs.mkdirSync(writableRoot, { recursive: true })
  const recovery = fs.mkdtempSync(path.join(writableRoot, '.db-save-'))
  const prepared: PreparedFile[] = []

  try {
    if (targets.some(({ resolved }) => path.relative(resolved, recovery) === '')) {
      throw new Error('Target collides with recovery directory')
    }
    for (const { file, resolved } of targets) {
      const entry: PreparedFile = { resolved, temp: path.join(recovery, `${prepared.length}.tmp`), replaced: false }
      prepared.push(entry) // Track ownership before a write that may leave partial bytes.
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      if (fs.existsSync(resolved)) {
        if (!fs.lstatSync(resolved).isFile()) throw new Error(`Target is not a regular file: ${resolved}`)
        entry.backup = path.join(recovery, `${prepared.length - 1}.bak`)
        fs.copyFileSync(resolved, entry.backup, fs.constants.COPYFILE_EXCL)
      }
      fs.writeFileSync(entry.temp, file.content, { encoding: 'utf8', flag: 'wx' })
    }
    for (const entry of prepared) {
      fs.renameSync(entry.temp, entry.resolved)
      entry.replaced = true
    }
  } catch (error) {
    const failures: string[] = []
    for (const entry of [...prepared].reverse()) {
      if (entry.replaced) {
        try {
          if (entry.backup) fs.renameSync(entry.backup, entry.resolved)
          else fs.rmSync(entry.resolved, { force: true }) // Never recursively remove a target directory.
        } catch (rollbackError) {
          failures.push(`Restore ${entry.resolved}${entry.backup ? ` from ${entry.backup}` : ' by removing the new file'}: ${errorMessage(rollbackError)}`)
        }
      }
      try {
        fs.rmSync(entry.temp, { force: true })
      } catch (cleanupError) {
        failures.push(`Remove staging file ${entry.temp}: ${errorMessage(cleanupError)}`)
      }
    }
    if (failures.length === 0) {
      try {
        fs.rmSync(recovery, { recursive: true, force: true })
      } catch (cleanupError) {
        failures.push(errorMessage(cleanupError))
      }
    }
    if (failures.length > 0) {
      throw new Error(`${errorMessage(error)}; recovery required at ${recovery}: ${failures.join('; ')}`)
    }
    throw error
  }
  // Cleanup errors after commit must not trigger rollback with partially removed backups.
  try {
    fs.rmSync(recovery, { recursive: true, force: true })
  } catch (error) {
    throw new Error(`Files saved, but recovery cleanup failed at ${recovery}: ${errorMessage(error)}`)
  }
}

/** Запрос от самой страницы dev-сервера, а не от чужого сайта (см. докблок модуля) */
function isTrustedRequest(req: IncomingMessage): boolean {
  const contentType = req.headers['content-type'] ?? ''

  if (!contentType.toLowerCase().startsWith('application/json')) return false

  const origin = req.headers.origin

  if (origin === undefined) return true

  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function dbEditorPlugin(options: PluginOptions = {}): Plugin {
  const writableRoot = path.resolve(process.cwd(), options.writableRoot ?? 'storage/database')
  const route = options.route ?? '/__db/save'

  return {
    name: 'titan-db-editor',
    apply: 'serve', // только dev — в production-сборку плагин не входит

    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        if (!isTrustedRequest(req)) {
          res.statusCode = 403
          res.end(JSON.stringify({ ok: false, error: 'Forbidden: same-origin application/json only' }))
          return
        }

        let body = ''
        // Decode across chunk boundaries: a UTF-8 character may span multiple buffers.
        req.setEncoding('utf8')
        req.on('data', (chunk) => {
          body += chunk
          // примитивная защита от гигантских тел
          if (body.length > 50 * 1024 * 1024) {
            res.statusCode = 413
            res.end('Payload Too Large')
            req.destroy()
          }
        })

        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { files?: SaveFile[] }

            if (!parsed.files || !Array.isArray(parsed.files)) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'Expected { files: [...] }' }))
              return
            }

            // Все пути — до первой записи: отказ посреди набора оставлял часть таблиц новой
            const targets: Array<{ file: SaveFile; resolved: string }> = []

            for (const file of parsed.files) {
              const resolved = path.resolve(process.cwd(), file.path)

              // защита от выхода за пределы writableRoot
              const rel = path.relative(writableRoot, resolved)
              if (rel.startsWith('..') || path.isAbsolute(rel)) {
                res.statusCode = 403
                res.end(JSON.stringify({ ok: false, error: `Path escapes writable root: ${file.path}` }))
                return
              }

              const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
              const collision = targets.some((target) => {
                const other = process.platform === 'win32' ? target.resolved.toLowerCase() : target.resolved
                return key === other || key.startsWith(`${other}${path.sep}`) || other.startsWith(`${key}${path.sep}`)
              })
              if (collision) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, error: `Conflicting target paths: ${file.path}` }))
                return
              }
              // Existing directories and symlinks cannot participate in safe file rollback.
              let ancestor = resolved
              while (path.relative(writableRoot, ancestor) !== '') {
                if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) {
                  throw new Error(`Symbolic links are not supported: ${ancestor}`)
                }
                ancestor = path.dirname(ancestor)
              }
              if (fs.existsSync(resolved) && !fs.lstatSync(resolved).isFile()) {
                throw new Error(`Target is not a regular file: ${resolved}`)
              }

              targets.push({ file, resolved })
            }

            saveBatch(targets, writableRoot)
            const written = targets.map(({ file }) => file.path)

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, written }))

            server.config.logger.info(`[titan-db-editor] wrote ${written.length} file(s): ${written.join(', ')}`)
          } catch (error) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
          }
        })
      })
    }
  }
}
