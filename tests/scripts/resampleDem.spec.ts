import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resampleDem } from '../../scripts/lib/resampleDem'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dem-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('resampleDem: чтение и ресемпл DEM', () => {
  it('возвращает запрошенные размеры и сохраняет порядок высот', async () => {
    // Синтетический DEM 4×2: яркость растёт слева направо. 8-бит PNG достаточно:
    // проверяется конвейер чтение→ресемпл→float, а не глубина исходника —
    // реальный GeoTIFF идёт тем же путём.
    const input = join(dir, 'dem.png')
    const pixels = Buffer.from([0, 60, 120, 250, 0, 60, 120, 250])
    await sharp(pixels, { raw: { width: 4, height: 2, channels: 1 } }).png().toFile(input)

    const dem = await resampleDem(input, 4, 2)

    expect(dem.width).toBe(4)
    expect(dem.height).toBe(2)
    expect(dem.data.length).toBe(8)
    expect(dem.data[3]).toBeGreaterThan(dem.data[0])
  })

  it('даунсемпл меняет размеры на запрошенные', async () => {
    const input = join(dir, 'dem2.png')
    const pixels = Buffer.alloc(8 * 4, 128)
    await sharp(pixels, { raw: { width: 8, height: 4, channels: 1 } }).png().toFile(input)

    const dem = await resampleDem(input, 4, 2)

    expect(dem.width).toBe(4)
    expect(dem.height).toBe(2)
    expect(dem.data.length).toBe(8)
  })
})
