import process from 'node:process'
import { convertCubemapDirectory } from './lib/convertCubemapDirectory'

/**
 * Уменьшение граней кубмапы вдвое.
 *
 * Запуск: npm run downscale:cubemap -- --in <папка> --out <папка> [--quality 92]
 *
 * Операция ровно одна — деление стороны на 2. Произвольный целевой размер
 * потребовал бы настоящего фильтра ресемплинга, а на точечных источниках
 * (звёздах) он даёт либо звон, либо замыливание. Нужна четверть — запустить
 * дважды.
 */
function argument(name: string): string | undefined {
  const index: number = process.argv.indexOf(`--${name}`)

  return index === -1 ? undefined : process.argv[index + 1]
}

const input: string | undefined = argument('in')
const output: string | undefined = argument('out')
const quality: number = Number(argument('quality') ?? 92)

if (!input || !output) {
  console.error('Нужны --in <папка> и --out <папка>')
  process.exit(1)
}

const written: string[] = await convertCubemapDirectory(input, output, quality)

for (const file of written) {
  console.log(`записано ${file}`)
}
