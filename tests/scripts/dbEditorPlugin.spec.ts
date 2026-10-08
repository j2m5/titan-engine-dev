import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { PassThrough } from 'node:stream'
import type { IncomingHttpHeaders } from 'node:http'
import { dbEditorPlugin } from '../../vite/dbEditorPlugin'

/**
 * Транспорт редактора данных пишет TS-исходники, которые импортирует
 * приложение. Чужой сайт в соседней вкладке не должен мочь записать сюда
 * ничего, а отказ посреди набора — оставить часть таблиц новой.
 */

type Handler = (req: unknown, res: unknown) => void

const HOST = '127.0.0.1:8085'
const SAME_ORIGIN = { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/json' }

let root: string
let handler: Handler

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'db-editor-'))

  const plugin = dbEditorPlugin({ writableRoot: root })
  const configure = plugin.configureServer as (server: unknown) => void

  configure({
    middlewares: { use: (_route: string, h: Handler): void => void (handler = h) },
    config: { logger: { info: (): void => {} } }
  })
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

function post(headers: IncomingHttpHeaders, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = Object.assign(new PassThrough(), { method: 'POST', headers })
    const res = {
      statusCode: 200,
      setHeader: (): void => {},
      end(text: string): void {
        resolve({ status: res.statusCode, body: text })
      }
    }

    handler(req, res)
    req.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
}

const file = (name: string): string => path.join(root, name)
const read = (name: string): string => fs.readFileSync(file(name), 'utf8')

describe('dbEditorPlugin: запись только от своей страницы', () => {
  it('JSON со своего origin — пишет файлы', async () => {
    const result = await post(SAME_ORIGIN, { files: [{ path: file('actors.ts'), content: 'A' }] })

    expect(result.status).toBe(200)
    expect(read('actors.ts')).toBe('A')
  })

  it('text/plain («простой» запрос без CORS-префлайта) — 403, ничего не записано', async () => {
    const result = await post(
      { ...SAME_ORIGIN, 'content-type': 'text/plain' },
      { files: [{ path: file('actors.ts'), content: 'X' }] }
    )

    expect(result.status).toBe(403)
    expect(fs.existsSync(file('actors.ts'))).toBe(false)
  })

  it('чужой Origin — 403, ничего не записано', async () => {
    const result = await post(
      { ...SAME_ORIGIN, origin: 'https://evil.example' },
      { files: [{ path: file('actors.ts'), content: 'X' }] }
    )

    expect(result.status).toBe(403)
    expect(fs.existsSync(file('actors.ts'))).toBe(false)
  })

  it('без Origin (скрипт, не браузер) — JSON принимается', async () => {
    const result = await post(
      { host: HOST, 'content-type': 'application/json' },
      { files: [{ path: file('actors.ts'), content: 'S' }] }
    )

    expect(result.status).toBe(200)
    expect(read('actors.ts')).toBe('S')
  })
})

describe('dbEditorPlugin: запись — всё или ничего', () => {
  it('выход за корень во втором файле — 403, первый файл не тронут', async () => {
    fs.writeFileSync(file('actors.ts'), 'old')

    const result = await post(SAME_ORIGIN, {
      files: [
        { path: file('actors.ts'), content: 'new' },
        { path: path.join(root, '..', 'escape.ts'), content: 'X' }
      ]
    })

    expect(result.status).toBe(403)
    expect(read('actors.ts')).toBe('old')
  })

  it('сбой записи на втором файле — исходники не тронуты, временных файлов не осталось', async () => {
    fs.writeFileSync(file('actors.ts'), 'old')
    // родитель второго пути — файл, mkdir упадёт
    fs.writeFileSync(file('blocker'), '')

    const result = await post(SAME_ORIGIN, {
      files: [
        { path: file('actors.ts'), content: 'new' },
        { path: path.join(root, 'blocker', 'orbits.ts'), content: 'X' }
      ]
    })

    expect(result.status).toBe(500)
    expect(read('actors.ts')).toBe('old')
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('успешный набор заменяет все файлы, временных не остаётся', async () => {
    fs.writeFileSync(file('actors.ts'), 'old A')
    fs.writeFileSync(file('orbits.ts'), 'old B')

    const result = await post(SAME_ORIGIN, {
      files: [
        { path: file('actors.ts'), content: 'new A' },
        { path: file('orbits.ts'), content: 'new B' }
      ]
    })

    expect(JSON.parse(result.body)).toEqual({ ok: true, written: [file('actors.ts'), file('orbits.ts')] })
    expect(read('actors.ts')).toBe('new A')
    expect(read('orbits.ts')).toBe('new B')
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
