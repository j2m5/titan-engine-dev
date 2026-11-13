import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resampleDem } from '../../scripts/lib/resampleDem'
import { DEM_16BIT_PNG } from '../helpers/demPngFixture'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dem-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('resampleDem: чтение и ресемпл DEM', () => {
  it('сохраняет числовые значения обычного 8-битного PNG', async () => {
    const input = join(dir, 'dem.png')
    const pixels = Buffer.from([0, 60, 120, 250, 0, 60, 120, 250])
    await sharp(pixels, { raw: { width: 4, height: 2, channels: 1 } }).png().toFile(input)

    const dem = await resampleDem(input, 4, 2)

    expect(dem.width).toBe(4)
    expect(dem.height).toBe(2)
    expect(dem.data.length).toBe(8)
    expect(Array.from(dem.data)).toEqual([0, 60, 120, 250, 0, 60, 120, 250])
  })

  it.each([
    { name: 'grayscale', png: DEM_16BIT_PNG, width: 8, samples: [0, 1, 255, 256, 10000, 10001, 32768, 65535] },
    {
      name: 'RGB', width: 4, samples: [10000, 10001, 30000, 60000],
      // Other channels deliberately differ: heights come from red, not luminance.
      png: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAABEAIAAAAmzkTZAAAAIUlEQVR4nGNQF/j/n4FBXZCB4f//UoMGBkaGVwkGlmHnAGWfCGm283I4AAAAAElFTkSuQmCC', 'base64')
    },
    {
      name: 'RGB-with-ICC', width: 4, samples: [10000, 10001, 30000, 60000],
      // Same independent pixel bytes as above, with an sRGB iCCP chunk attached.
      png: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAABEAIAAAAmzkTZAAABP2lDQ1BzUkdCAAB4nH2QvUsCcRzGP9dVllgNOTQUHCVNBVFLU4EXOkXgS6hN5/kWqF13F9JcDk1FQzRaSxDNNubQHxAEDVEQba0GNZRc/DTQgnqW74eH54EvD0hPeb1gdStQKNpmKOhXYvGE4npGxks/g4xpumUshwMRAEsrWbpt5vmhtzskcW+nc1oxtf1ytZpYkKo7E+Vo4H3lnP/lTqUtHfgEfLph2iApwHjJNgQvAV49p6VAigFTZiyeAGlX+NkWHwtOtvhCsBkJqSDVACXbwckOLuS39O8fxPeedDEaBvqAUSxCBPH/keltZlRUZkDs9XsHKzM322p5FqHn0XFeJ8F1AI1Dx/k4cZzGKcgPUNts9zcqMF8Heb/tJY/gcg9G7tuerwJDZaheG5qpNS0Z6MqsQ/0MBuIwfAPutS/j4l+xl08bWwAAACFJREFUeJxjUBf4/5+BQV2QgeH//1KDBgZGhlcJBpZh5wBlnwhptvNyOAAAAABJRU5ErkJggg==', 'base64')
    }
  ])('сохраняет 16-битные высоты и разницу в один отсчёт: $name', async ({ name, png, width, samples }) => {
    const input = join(dir, `dem16-${name}.png`)
    await writeFile(input, png)
    const metadata = await sharp(input).metadata()
    expect(metadata).toMatchObject({ depth: 'ushort', bitsPerSample: 16 })
    if (name === 'RGB-with-ICC') expect(metadata.hasProfile).toBe(true)

    const dem = await resampleDem(input, width, 1)

    expect([dem.width, dem.height, dem.data.length]).toEqual([width, 1, width])
    expect(Array.from(dem.data)).toEqual(samples)
  })

  it('сохраняет абсолютную высоту 16-битного PNG при изменении размера', async () => {
    const input = join(dir, 'constant16.png')
    // Independently encoded 8 x 4 PNG, every sample is 10001.
    await writeFile(input, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAEEAAAAADGNv1vAAAAEElEQVR4nGNQF0SFDKQLAADvpAcBrEC95wAAAABJRU5ErkJggg==', 'base64'
    ))

    const dem = await resampleDem(input, 4, 2)

    expect([dem.width, dem.height]).toEqual([4, 2])
    expect(Array.from(dem.data)).toEqual([10001, 10001, 10001, 10001, 10001, 10001, 10001, 10001])
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
