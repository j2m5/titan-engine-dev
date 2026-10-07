import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/core/helpers/downloadBlob', () => ({ downloadBlob: vi.fn() }))

import { TakeScreenshot } from '@/core/commands/TakeScreenshot'
import { downloadBlob } from '@/core/helpers/downloadBlob'
import type { NotificationSink, SystemNotification } from '@/core/ports/NotificationSink'

const NOW = new Date(2026, 9, 7, 14, 5, 9)

function sink(): NotificationSink & { sent: SystemNotification[] } {
  const sent: SystemNotification[] = []

  return { sent, dispatch: (notification: SystemNotification): void => void sent.push(notification) }
}

function command(capture: () => Promise<Blob | null>, notifications: NotificationSink): TakeScreenshot {
  return new TakeScreenshot({ captureScreenshot: capture }, notifications, () => NOW)
}

describe('TakeScreenshot', () => {
  beforeEach(() => vi.mocked(downloadBlob).mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('сохраняет снимок с именем по местному времени и сообщает об успехе', async () => {
    const blob = new Blob(['png'])
    const notifications = sink()

    await command(() => Promise.resolve(blob), notifications).handle()

    expect(downloadBlob).toHaveBeenCalledWith(blob, 'screenshot-2026-10-07_14-05-09.png')
    expect(notifications.sent).toEqual([{ type: 'success', message: 'Screenshot saved' }])
  })

  it('пустой снимок (toBlob вернул null) — ошибка без файла', async () => {
    const notifications = sink()

    await command(() => Promise.resolve(null), notifications).handle()

    expect(downloadBlob).not.toHaveBeenCalled()
    expect(notifications.sent).toEqual([{ type: 'error', message: 'Screenshot failed' }])
  })

  it('исключение при съёмке — ошибка, и следующий клик снова работает', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const notifications = sink()

    await command(() => {
      throw new Error('context lost')
    }, notifications).handle()

    expect(notifications.sent).toEqual([{ type: 'error', message: 'Screenshot failed' }])

    await command(() => Promise.resolve(new Blob(['png'])), notifications).handle()

    expect(downloadBlob).toHaveBeenCalledTimes(1)
  })

  it('двойной клик, пока кодируется PNG, второй снимок не делает (команды transient)', async () => {
    let resolve!: (blob: Blob | null) => void
    const pending = new Promise<Blob | null>((r) => (resolve = r))
    const capture = vi.fn(() => pending)
    const notifications = sink()

    const first = command(capture, notifications).handle()
    await command(capture, notifications).handle()
    resolve(new Blob(['png']))
    await first

    expect(capture).toHaveBeenCalledTimes(1)
    expect(downloadBlob).toHaveBeenCalledTimes(1)
  })
})
