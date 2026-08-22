import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { dbPathFor } from '../../scripts/lib/dbPathFor'

describe('dbPathFor', () => {
  it('срезает корень и приводит разделители ОС к /', () => {
    const local = path.join('storage/images/textures/planets', 'io', 'io_slope.webp')
    expect(dbPathFor(local, 'storage/images/textures')).toBe('planets/io/io_slope.webp')
  })

  it('вложенный путь (StarWars/korriban) — тот же корень', () => {
    const local = path.join('storage/images/textures/planets', 'StarWars', 'korriban', 'i', 'korriban1_slope.webp')
    expect(dbPathFor(local, 'storage/images/textures')).toBe('planets/StarWars/korriban/i/korriban1_slope.webp')
  })
})
