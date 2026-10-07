/** Высота снимка — 4K по вертикали; ширина идёт за пропорцией окна */
export const SCREENSHOT_HEIGHT: number = 2160

export interface ScreenshotSize {
  width: number
  height: number
}

/**
 * Размер снимка «как на экране»: высота SCREENSHOT_HEIGHT, ширина по пропорции
 * вьюпорта. У камеры остаётся тот же aspect — кадр не тянется и не режется
 * (окно 16:9 даёт ровно 3840×2160).
 *
 * Ни одна сторона не больше maxSize (предел текстуры и renderbuffer у GPU):
 * сверхширокое окно ужимается пропорционально, а не обрезается. Вырожденный
 * вьюпорт (свёрнутое окно) снимается в 16:9.
 */
export function screenshotSize(
  viewportWidth: number,
  viewportHeight: number,
  maxSize: number,
  height: number = SCREENSHOT_HEIGHT
): ScreenshotSize {
  const aspect: number = viewportWidth > 0 && viewportHeight > 0 ? viewportWidth / viewportHeight : 16 / 9
  const width: number = Math.round(height * aspect)
  const scale: number = Math.min(1, maxSize / Math.max(width, height))

  if (scale === 1) return { width, height }

  return { width: Math.floor(width * scale), height: Math.floor(height * scale) }
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

/** Имя файла по местному времени снимка; без двоеточий — их не любят файловые системы */
export function screenshotFilename(date: Date): string {
  const day: string = `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
  const time: string = `${twoDigits(date.getHours())}-${twoDigits(date.getMinutes())}-${twoDigits(date.getSeconds())}`

  return `screenshot-${day}_${time}.png`
}
