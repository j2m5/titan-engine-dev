import { describe, expect, it } from 'vitest'
import { CODE_REFERENCED_PATHS, cloudManifestPaths } from '../../scripts/lib/cloudManifest'
import type { IResource } from '@/core/models/types'

const row = (id: number, path: string): IResource => ({ id, resourceType: 'diffuse', lifecycle: 'streamable', path })

describe('cloudManifestPaths: список файлов, нужных рантайму в облаке', () => {
  it('включает пути всех ресурсов и статические файлы, грузящиеся кодом мимо БД', () => {
    const paths = cloudManifestPaths([row(1, 'planets/moon/moon.jpg')])

    expect(paths).toContain('planets/moon/moon.jpg')
    for (const p of CODE_REFERENCED_PATHS) expect(paths).toContain(p)
  })

  it('каждой height-карте добавляет производный .aux (рантайм выводит путь сам, строки в БД нет)', () => {
    const paths = cloudManifestPaths([{ id: 1, resourceType: 'height', lifecycle: 'resident', path: 'planets/moon/moon_height.raw' }])

    expect(paths).toContain('planets/moon/moon_height.raw')
    expect(paths).toContain('planets/moon/moon_height.aux')
  })

  it('дедуплицирует шаренные пути и сортирует детерминированно', () => {
    const paths = cloudManifestPaths([row(1, 'terrain/ice_diff.webp'), row(2, 'terrain/ice_diff.webp'), row(3, 'a.jpg')])

    expect(paths.filter((p) => p === 'terrain/ice_diff.webp')).toHaveLength(1)
    expect([...paths].sort()).toEqual(paths)
  })
})
