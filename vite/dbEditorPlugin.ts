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
 * Запись — всё или ничего: пути проверяются до первой записи, файлы пишутся
 * во временные рядом и только потом переименовываются поверх.
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

              targets.push({ file, resolved })
            }

            // Сначала все временные файлы: сбой на любом — подчищаем их, исходники не тронуты.
            // Потом переименования поверх (в той же папке, атомарны по файлу)
            const temps: string[] = []

            try {
              for (const { file, resolved } of targets) {
                const temp = `${resolved}.${process.pid}.${temps.length}.tmp`

                fs.mkdirSync(path.dirname(resolved), { recursive: true })
                fs.writeFileSync(temp, file.content, 'utf8')
                temps.push(temp)
              }
            } catch (error) {
              for (const temp of temps) fs.rmSync(temp, { force: true })
              throw error
            }

            const written: string[] = []

            targets.forEach(({ file, resolved }, i) => {
              fs.renameSync(temps[i], resolved)
              written.push(file.path)
            })

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
