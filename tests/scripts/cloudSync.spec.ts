import { describe, expect, it } from 'vitest'
import { Resources } from '@storage/database/resources'
import { cloudManifestPaths } from '../../scripts/lib/cloudManifest'
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
  type ObjectPage,
  type RemoteObject
} from '../../scripts/lib/cloudSync'

const MD5 = 'ca0c175a33b38e0f105e5d30b06bb2e6'
const file = (path: string, size = 10, md5 = MD5): LocalFile => ({ path, size, md5 })
const object = (key: string, size = 10, etag: string | undefined = `"${MD5}"`): RemoteObject => ({ key, size, etag })

describe('isDryRun: только план', () => {
  it('флаг после «--» доходит до скрипта', () => {
    expect(isDryRun(['node', 'cloud-sync.ts', '--dry-run'], {})).toBe(true)
  })

  it('без «--» npm забирает --dry-run себе (npm_config_dry_run) — всё равно план, не синк', () => {
    expect(isDryRun(['node', 'cloud-sync.ts'], { npm_config_dry_run: 'true' })).toBe(true)
  })

  it('без флага — синк', () => {
    expect(isDryRun(['node', 'cloud-sync.ts'], {})).toBe(false)
    expect(isDryRun(['node', 'cloud-sync.ts'], { npm_config_dry_run: 'false' })).toBe(false)
  })
})

describe('etagMatchesMd5: ETag объекта против MD5 файла', () => {
  it('кавычки и регистр не важны', () => {
    expect(etagMatchesMd5(`"${MD5.toUpperCase()}"`, MD5)).toBe(true)
    expect(etagMatchesMd5(MD5, MD5.toUpperCase())).toBe(true)
  })

  it('другой хеш или нет ETag — не совпадают', () => {
    expect(etagMatchesMd5('"00000000000000000000000000000000"', MD5)).toBe(false)
    expect(etagMatchesMd5(undefined, MD5)).toBe(false)
  })

  it('ETag multipart-заливки («-N») с MD5 несравним', () => {
    expect(etagMatchesMd5(`"${MD5}-3"`, MD5)).toBe(false)
  })
})

describe('diffContent: что заливать', () => {
  it('нет объекта — новый; разошёлся размер или ETag — изменённый; совпал — к сверке заголовков', () => {
    const diff = diffContent(
      [file('a.png'), file('b.png'), file('c.png'), file('d.png')],
      [object('b.png', 11), object('c.png', 10, '"ffffffffffffffffffffffffffffffff"'), object('d.png')]
    )

    expect(diff.uploadsNew.map((f) => f.path)).toEqual(['a.png'])
    expect(diff.uploadsChanged.map((f) => f.path)).toEqual(['b.png', 'c.png'])
    expect(diff.matched.map((f) => f.path)).toEqual(['d.png'])
    expect(diff.orphans).toEqual([])
  })

  it('multipart-объект того же размера — изменённый: перезаливается одним запросом', () => {
    const diff = diffContent([file('a.raw')], [object('a.raw', 10, `"${MD5}-2"`)])

    expect(diff.uploadsChanged.map((f) => f.path)).toEqual(['a.raw'])
  })

  it('лишнее — объекты вне манифеста со своими размерами; «папки» на «/» не лишние', () => {
    const diff = diffContent([file('a.png')], [object('a.png'), object('old/x.prev.raw', 4096), object('planets/', 0)])

    expect(diff.orphans).toEqual([object('old/x.prev.raw', 4096)])
    expect(isFolderMarker('planets/')).toBe(true)
    expect(isFolderMarker('planets/moon.jpg')).toBe(false)
  })
})

describe('headersUpToDate: заголовки как у заливки', () => {
  it('no-cache и тип по расширению — в порядке', () => {
    expect(headersUpToDate('a/b.webp', { cacheControl: CLOUD_CACHE_CONTROL, contentType: 'image/webp' })).toBe(true)
  })

  it('нет Cache-Control или чужой Content-Type — править', () => {
    expect(headersUpToDate('a/b.webp', { cacheControl: undefined, contentType: 'image/webp' })).toBe(false)
    expect(headersUpToDate('a/b.webp', { cacheControl: CLOUD_CACHE_CONTROL, contentType: 'application/octet-stream' })).toBe(false)
  })
})

describe('contentTypeFor: тип по расширению', () => {
  it('карта, регистр расширения не важен', () => {
    expect(contentTypeFor('x/a.jpg')).toBe('image/jpeg')
    expect(contentTypeFor('x/a.JPEG')).toBe('image/jpeg')
    expect(contentTypeFor('x/a.png')).toBe('image/png')
    expect(contentTypeFor('x/a.webp')).toBe('image/webp')
    for (const extension of ['raw', 'aux', 'bin', 'dat']) {
      expect(contentTypeFor(`x/a.${extension}`)).toBe('application/octet-stream')
    }
  })

  it('незнакомое расширение или его нет — ошибка с подсказкой', () => {
    expect(() => contentTypeFor('x/a.tiff')).toThrow(/CONTENT_TYPES/)
    expect(() => contentTypeFor('x.dir/readme')).toThrow(/CONTENT_TYPES/)
    expect(() => contentTypeFor('x/a.constructor')).toThrow(/CONTENT_TYPES/)
  })

  it('карта покрывает весь настоящий манифест', () => {
    for (const path of cloudManifestPaths(Resources)) expect(() => contentTypeFor(path)).not.toThrow()
  })
})

describe('deletionVerdict: предохранитель удаления', () => {
  it('без сбоев и не больше половины — можно', () => {
    expect(deletionVerdict(10, 800, false)).toEqual({ allowed: true })
    expect(deletionVerdict(400, 800, false)).toEqual({ allowed: true })
  })

  it('больше половины объектов бакета — отказ с причиной', () => {
    const verdict = deletionVerdict(401, 800, false)

    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toMatch(/половин/)
  })

  it('в прогоне были сбои — удаление пропущено', () => {
    expect(deletionVerdict(1, 800, true).allowed).toBe(false)
  })
})

describe('copySourceFor: источник копии в себя', () => {
  it('сегменты кодируются по отдельности, «/» остаются', () => {
    expect(copySourceFor('textures', 'planets/StarWars/a b.png')).toBe('textures/planets/StarWars/a%20b.png')
  })
})

describe('listAllObjects: листинг бакета постранично', () => {
  it('проходит все страницы по токену продолжения', async () => {
    const pages: Record<string, ObjectPage> = {
      first: { objects: [object('a.png')], nextToken: 't1' },
      t1: { objects: [object('b.png')], nextToken: 't2' },
      t2: { objects: [object('c.png')], nextToken: undefined }
    }
    const tokens: (string | undefined)[] = []

    const objects = await listAllObjects(async (token) => {
      tokens.push(token)
      return pages[token ?? 'first']
    })

    expect(objects.map((o) => o.key)).toEqual(['a.png', 'b.png', 'c.png'])
    expect(tokens).toEqual([undefined, 't1', 't2'])
  })
})

describe('runConcurrent: пул задач', () => {
  it('каждая задача — ровно раз, параллельно не больше предела', async () => {
    let active = 0
    let peak = 0
    const done: number[] = []

    await runConcurrent([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      done.push(n)
      active--
    })

    expect([...done].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(peak).toBe(3)
  })

  it('пустой список — без задач', async () => {
    let calls = 0
    await runConcurrent([], 4, async () => {
      calls++
    })
    expect(calls).toBe(0)
  })
})
