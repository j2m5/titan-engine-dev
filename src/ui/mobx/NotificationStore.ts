import { makeAutoObservable } from 'mobx'
import { NotificationSink, SystemNotification } from '@/core/ports/NotificationSink'

type IdentifiedSystemNotification = SystemNotification & { id: number }

class NotificationStore implements NotificationSink {
  public delay: number = 5000
  public maxQueueSize: number = 10
  public notifications: IdentifiedSystemNotification[] = []

  public constructor() {
    makeAutoObservable(this)
  }

  public dispatch(notification: SystemNotification): void {
    if (this.notifications.length < this.maxQueueSize) {
      this.notifications.push({ ...notification, id: Date.now() })
    }
  }

  public release(id: number): void {
    this.notifications = this.notifications.filter(
      (notification: IdentifiedSystemNotification): boolean => notification.id !== id
    )
  }
}

export const notificationStore: NotificationStore = new NotificationStore()
