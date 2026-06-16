import type { Plugin } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Dev-only транспорт для редактора данных.
 *
 * Принимает POST /__db/save с телом { files: [{ path, content }] }
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

            const written: string[] = []

            for (const file of parsed.files) {
              const resolved = path.resolve(process.cwd(), file.path)

              // защита от выхода за пределы writableRoot
              const rel = path.relative(writableRoot, resolved)
              if (rel.startsWith('..') || path.isAbsolute(rel)) {
                res.statusCode = 403
                res.end(JSON.stringify({ ok: false, error: `Path escapes writable root: ${file.path}` }))
                return
              }

              fs.mkdirSync(path.dirname(resolved), { recursive: true })
              fs.writeFileSync(resolved, file.content, 'utf8')
              written.push(file.path)
            }

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
