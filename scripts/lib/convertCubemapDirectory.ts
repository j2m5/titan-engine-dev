import { Buffer } from 'node:buffer'
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { downscaleHalfLinear } from './downscaleHalfLinear'

/**
 * Конвертирует все файлы входной папки, деля сторону каждого вдвое.
 *
 * Выходная папка обязана быть пустой или отсутствовать: оригиналы граней лежат
 * вне git, и повторный запуск по уже сконвертированной папке уничтожил бы
 * единственную копию.
 *
 * Имена файлов сохраняются, расширение выходных — `.jpg`: грани скайбокса и так
 * хранятся в JPEG, а PNG на 3000² весил бы десятки мегабайт.
 */
export async function convertCubemapDirectory(
  inputDir: string,
  outputDir: string,
  quality: number
): Promise<string[]> {
  const entries: string[] = await readdir(inputDir)

  if (entries.length === 0) {
    throw new Error(`Во входной папке ни одного файла: ${inputDir}`)
  }

  let existing: string[] = []

  try {
    existing = await readdir(outputDir)
  } catch {
    // папки нет — это нормальный случай, создадим ниже
  }

  if (existing.length > 0) {
    throw new Error(`Выходная папка непуста, отказываюсь затирать: ${outputDir}`)
  }

  await mkdir(outputDir, { recursive: true })

  const written: string[] = []

  for (const entry of entries) {
    const source = sharp(path.join(inputDir, entry))
    const { data, info } = await source.raw().toBuffer({ resolveWithObject: true })

    const halved: Uint8Array = downscaleHalfLinear(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      info.width,
      info.height,
      info.channels
    )

    const target: string = path.join(outputDir, `${path.parse(entry).name}.jpg`)

    await sharp(Buffer.from(halved), {
      raw: {
        width: info.width / 2,
        height: info.height / 2,
        channels: info.channels as 1 | 2 | 3 | 4
      }
    })
      // 4:4:4 обязательно: при 4:2:0 цвет усредняется блоками 2×2 поверх нашего
      // усреднения, и однопиксельные звёзды теряют оттенок
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toFile(target)

    written.push(target)
  }

  return written
}
