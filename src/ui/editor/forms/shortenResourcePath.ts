export function shortenResourcePath(path: string): string {
  const segments = path.split('/').filter(Boolean)

  if (segments.length <= 2) {
    // 'sun_glow.png' или 'dir/file.png' — уже короткий, без многоточия
    return segments.join('/')
  }

  const tail = segments.slice(-2).join('/') // последняя папка + файл
  return `…/${tail}`
}
