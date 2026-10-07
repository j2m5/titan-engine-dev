import { Command } from '@/core/framework/commands/Command'
import type { Postprocessing } from '@/core/graphic/Postprocessing'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import { screenshotFilename } from '@/core/graphic/screenshot'
import { downloadBlob } from '@/core/helpers/downloadBlob'

/**
 * 4K-снимок кадра (кнопка ImageIcon в MainAppBar): Postprocessing рендерит,
 * команда сохраняет файл и сообщает результат.
 *
 * Флаг «снимок идёт» статический: команды transient (каждый execute() —
 * свежий экземпляр), а двойной клик, пока кодируется PNG, второго файла
 * делать не должен.
 */
class TakeScreenshot extends Command {
  private static busy: boolean = false

  public constructor(
    private readonly postprocessing: Pick<Postprocessing, 'captureScreenshot'>,
    private readonly notifications: NotificationSink,
    private readonly now: () => Date = (): Date => new Date()
  ) {
    super()
  }

  public async handle(): Promise<void> {
    if (TakeScreenshot.busy) return

    TakeScreenshot.busy = true

    try {
      const blob: Blob | null = await this.postprocessing.captureScreenshot()

      if (!blob) {
        this.notifications.dispatch({ type: 'error', message: 'Screenshot failed' })

        return
      }

      downloadBlob(blob, screenshotFilename(this.now()))
      this.notifications.dispatch({ type: 'success', message: 'Screenshot saved' })
    } catch (error) {
      console.error('[TakeScreenshot]', error)
      this.notifications.dispatch({ type: 'error', message: 'Screenshot failed' })
    } finally {
      TakeScreenshot.busy = false
    }
  }
}

export { TakeScreenshot }
