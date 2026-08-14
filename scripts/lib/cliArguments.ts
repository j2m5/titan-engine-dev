import process from 'node:process'

/**
 * Значение флага `--name` из argv оффлайн-скриптов.
 *
 * Известная особенность: флаг без значения возвращает следующий флаг строкой
 * («--width --height 5» даст width = '--height») — вызывающие скрипты ловят
 * это валидацией Number.isFinite на числовых флагах.
 */
export function argument(name: string): string | undefined {
  const index: number = process.argv.indexOf(`--${name}`)

  return index === -1 ? undefined : process.argv[index + 1]
}
