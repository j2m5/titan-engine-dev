import { makeAutoObservable } from 'mobx'
import { SystemNotification } from '@/ui/types'

class NotificationStore {
  public notification: SystemNotification = {
    visible: false,
    type: 'info',
    message: ''
  }

  public constructor() {
    makeAutoObservable(this)
  }

  public openNotification({ type, message }: Pick<SystemNotification, 'type' | 'message'>): void {
    this.notification.visible = true
    this.notification.type = type
    this.notification.message = message
  }

  public closeNotification(): void {
    this.notification.visible = false
    this.notification.type = 'info'
    this.notification.message = ''
  }
}

export const notificationStore: NotificationStore = new NotificationStore()
