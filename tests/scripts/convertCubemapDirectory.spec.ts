import { Buffer } from 'node:buffer'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { convertCubemapDirectory } from '../../scripts/lib/convertCubemapDirectory'

/** Грань 8×8: один яркий пиксель в углу, остальное чёрное */
async function writeSyntheticFace(file: string): Promise<void> {
  const raw = new Uint8Array(8 * 8 * 3)

  raw[0] = 255
  raw[1] = 255
  raw[2] = 255

  await sharp(Buffer.from(raw), { raw: { width: 8, height: 8, channels: 3 } })
    .png()
    .toFile(file)
}

describe('convertCubemapDirectory: конвертация папки граней', () => {
  it('уменьшает грань вдвое и не теряет яркость ядра', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cubemap-'))
    const input = path.join(root, 'in')
    const output = path.join(root, 'out')

    await mkdir(input)
    await writeSyntheticFace(path.join(input, 'px.png'))

    const written = await convertCubemapDirectory(input, output, 92)

    expect(written).toHaveLength(1)

    const meta = await sharp(written[0]).metadata()

    expect(meta.width).toBe(4)
    expect(meta.height).toBe(4)

    const { data } = await sharp(written[0]).raw().toBuffer({ resolveWithObject: true })

    // блок [255,0,0,0] в линейном свете даёт 137; наивное усреднение в sRGB
    // дало бы 64. JPEG-кодирование сдвигает значение, но не на такую величину
    expect(data[0]).toBeGreaterThan(100)
  })

  it('отказывается писать в непустую папку — иначе повторный запуск затрёт оригиналы', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cubemap-'))
    const input = path.join(root, 'in')
    const output = path.join(root, 'out')

    await mkdir(input)
    await mkdir(output)
    await writeSyntheticFace(path.join(input, 'px.png'))
    await writeFile(path.join(output, 'уже-лежит.txt'), 'занято')

    await expect(convertCubemapDirectory(input, output, 92)).rejects.toThrow(/непуст/)
  })

  it('пустая входная папка — ошибка, а не тихий успех', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cubemap-'))
    const input = path.join(root, 'in')

    await mkdir(input)

    await expect(convertCubemapDirectory(input, path.join(root, 'out'), 92)).rejects.toThrow(
      /ни одного файла/
    )
  })
})
