/**
 * Через сколько освобождать object URL после клика. Сразу нельзя: часть
 * браузеров стартует загрузку асинхронно, и отозванный URL её обрывает.
 */
export const REVOKE_DELAY_MS: number = 10_000

/**
 * Сохраняет Blob на диск через скрытую ссылку download: браузер кладёт файл в
 * загрузки (или спрашивает место, если так настроен).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url: string = URL.createObjectURL(blob)
  const link: HTMLAnchorElement = document.createElement('a')

  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()

  setTimeout((): void => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
