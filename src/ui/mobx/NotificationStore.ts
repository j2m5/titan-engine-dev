import { makeAutoObservable } from 'mobx'
import { NotificationSink, SystemNotification } from '@/core/ports/NotificationSink'

type IdentifiedSystemNotification = SystemNotification & { id: number }

class NotificationStore implements NotificationSink {
  public delay: number = 5000
  public maxQueueSize: number = 10
  public notifications: IdentifiedSystemNotification[] = []

  /**
   * Монотонный счётчик, а не Date.now(): уведомления приходят пачками — например,
   * стример ресурсов докладывает о неудачных текстурах в цикле, — и в пределах
   * одной миллисекунды время давало одинаковый id. Это ломало и ключи React
   * в списке, и release(), который снимал сразу всех однопакетных соседей.
   */
  private nextId: number = 1

  public constructor() {
    makeAutoObservable(this)
  }

  public dispatch(notification: SystemNotification): void {
    if (this.notifications.length < this.maxQueueSize) {
      this.notifications.push({ ...notification, id: this.nextId++ })
    }
  }

  public release(id: number): void {
    this.notifications = this.notifications.filter(
      (notification: IdentifiedSystemNotification): boolean => notification.id !== id
    )
  }
}

export const notificationStore: NotificationStore = new NotificationStore()
