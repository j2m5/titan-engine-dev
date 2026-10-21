import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { PassThrough } from 'node:stream'
import type { IncomingHttpHeaders } from 'node:http'
import { dbEditorPlugin } from '../../vite/dbEditorPlugin'

vi.mock('node:fs', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs')>() }))

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

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

function post(headers: IncomingHttpHeaders, body: unknown, splitAt?: number): Promise<{ status: number; body: string }> {
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
    const encoded = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    if (splitAt !== undefined) req.write(encoded.subarray(0, splitAt))
    req.end(splitAt === undefined ? encoded : encoded.subarray(splitAt))
  })
}

const file = (name: string): string => path.join(root, name)
const read = (name: string): string => fs.readFileSync(file(name), 'utf8')

describe('dbEditorPlugin: batch recovery', () => {
  it.each([false, true])('rolls back a successful first replacement after the second rename fails (new=%s)', async (newTarget) => {
    const original = Buffer.from([0, 255, 13, 10, 128])
    if (!newTarget) fs.writeFileSync(file('actors.ts'), original)
    fs.writeFileSync(file('orbits.ts'), 'old B')
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination === file('orbits.ts')) throw new Error('injected second rename failure')
      rename(source, destination)
    })

    const result = await post(SAME_ORIGIN, { files: [
      { path: file('actors.ts'), content: 'new A' },
      { path: file('orbits.ts'), content: 'new B' }
    ] })

    expect(result.status).toBe(500)
    expect(result.body).toContain('injected second rename failure')
    if (newTarget) expect(fs.existsSync(file('actors.ts'))).toBe(false)
    else expect(fs.readFileSync(file('actors.ts'))).toEqual(original)
    expect(read('orbits.ts')).toBe('old B')
    expect(fs.readdirSync(root).sort()).toEqual(newTarget ? ['orbits.ts'] : ['actors.ts', 'orbits.ts'])
  })

  it('cleans a staging file even when its write fails after writing partial bytes', async () => {
    fs.writeFileSync(file('actors.ts'), 'old')
    const write = fs.writeFileSync
    vi.spyOn(fs, 'writeFileSync').mockImplementation((target, content, options) => {
      write(target, content, options)
      throw new Error('injected partial write failure')
    })
    const result = await post(SAME_ORIGIN, { files: [{ path: file('actors.ts'), content: 'new' }] })
    expect(result.status).toBe(500)
    expect(read('actors.ts')).toBe('old')
    expect(fs.readdirSync(root)).toEqual(['actors.ts'])
  })

  it.each(['normalized', 'case', 'ancestor'])('rejects %s target collisions before writing', async (kind) => {
    const first = file('actors.ts')
    const second = kind === 'normalized' ? path.join(root, 'nested', '..', 'actors.ts')
      : kind === 'case' ? file('ACTORS.TS') : path.join(first, 'child.ts')
    if (kind === 'case' && process.platform !== 'win32') return
    const result = await post(SAME_ORIGIN, { files: [
      { path: first, content: 'one' }, { path: second, content: 'two' }
    ] })
    expect(result.status).toBe(400)
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('preserves target directories and their contents', async () => {
    fs.mkdirSync(file('directory'))
    fs.writeFileSync(file('directory/keep'), 'keep')
    const result = await post(SAME_ORIGIN, { files: [{ path: file('directory'), content: 'new' }] })
    expect(result.status).toBe(500)
    expect(read('directory/keep')).toBe('keep')
    expect(fs.readdirSync(root)).toEqual(['directory'])
  })

  it.each([false, true])('keeps the original recovery copy when rollback fails (cleanup failure=%s)', async (cleanupFailure) => {
    fs.writeFileSync(file('actors.ts'), 'old A')
    fs.writeFileSync(file('orbits.ts'), 'old B')
    const rename = fs.renameSync
    let replaced = false
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination === file('orbits.ts') || (destination === file('actors.ts') && replaced)) {
        throw new Error('injected rename failure')
      }
      rename(source, destination)
      replaced = true
    })
    if (cleanupFailure) {
      const remove = fs.rmSync
      vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
        if (String(target).endsWith('.tmp')) throw new Error('injected staging cleanup failure')
        remove(target, options)
      })
    }
    const result = await post(SAME_ORIGIN, { files: [
      { path: file('actors.ts'), content: 'new A' }, { path: file('orbits.ts'), content: 'new B' }
    ] })
    expect(result.status).toBe(500)
    expect(result.body).toMatch(/recover/i)
    const recovery = fs.readdirSync(root).find((name) => fs.statSync(file(name)).isDirectory())
    expect(recovery).toBeDefined()
    const recoveryPath = file(recovery!)
    expect(JSON.parse(result.body).error).toContain(recoveryPath)
    expect(fs.readdirSync(recoveryPath).some((name) => fs.readFileSync(path.join(recoveryPath, name), 'utf8') === 'old A')).toBe(true)
  })

  it('leaves another request recovery data intact on success', async () => {
    fs.mkdirSync(file('.db-save-existing'))
    fs.writeFileSync(file('.db-save-existing/0.bak'), 'other request original')
    const result = await post(SAME_ORIGIN, { files: [{ path: file('actors.ts'), content: 'new' }] })
    expect(result.status).toBe(200)
    expect(read('.db-save-existing/0.bak')).toBe('other request original')
    expect(fs.readdirSync(root).sort()).toEqual(['.db-save-existing', 'actors.ts'])
  })
})

describe('dbEditorPlugin: запись только от своей страницы', () => {
  it.each(['Земля', '🪐'])('сохраняет UTF-8 при разрыве сетевого чанка внутри символа %s', async (content) => {
    const body = { files: [{ path: file('actors.ts'), content }] }
    const splitAt = Buffer.from(JSON.stringify(body)).indexOf(Buffer.from(content)) + 1

    const result = await post(SAME_ORIGIN, body, splitAt)

    expect(result.status).toBe(200)
    expect(read('actors.ts')).toBe(content)
  })

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
    expect(fs.readdirSync(root).sort()).toEqual(['actors.ts', 'orbits.ts'])
  })
})
