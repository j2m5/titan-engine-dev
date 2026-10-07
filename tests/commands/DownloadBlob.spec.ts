import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadBlob, REVOKE_DELAY_MS } from '@/core/helpers/downloadBlob'

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('кликает скрытую ссылку download, убирает её из DOM и освобождает object URL с задержкой', () => {
    vi.useFakeTimers()
    // jsdom не реализует object URL — ставим свои
    const create = vi.fn((): string => 'blob:shot')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation((): void => {})
    const blob = new Blob(['png'])

    downloadBlob(blob, 'screenshot-2026-10-07_14-05-09.png')

    // this каждого вызова click — сама ссылка
    const clicked = click.mock.contexts[0] as HTMLAnchorElement

    expect(click).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(blob)
    expect(clicked.download).toBe('screenshot-2026-10-07_14-05-09.png')
    expect(clicked.href).toBe('blob:shot')
    expect(clicked.isConnected).toBe(false)
    // Сразу после клика URL ещё жив: часть браузеров стартует загрузку асинхронно
    expect(revoke).not.toHaveBeenCalled()

    vi.advanceTimersByTime(REVOKE_DELAY_MS)

    expect(revoke).toHaveBeenCalledWith('blob:shot')
  })
})
