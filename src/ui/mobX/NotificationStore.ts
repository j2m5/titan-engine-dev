import { makeAutoObservable } from 'mobx'
import { INotification } from '@/ui/interfaces/INotification.ts'
import { NotificationMessageProps } from '@/ui/interfaces/NotificationMessageProps.ts'

class NotificationStore {
  public notification: INotification = {
    isOpen: false,
    type: 'info',
    message: ''
  }

  public constructor() {
    makeAutoObservable(this)
  }

  public openNotification({ type, message }: NotificationMessageProps): void {
    this.notification.isOpen = true
    this.notification.type = type
    this.notification.message = message
  }

  public closeNotification(): void {
    this.notification.isOpen = false
    this.notification.type = 'info'
    this.notification.message = ''
  }
}

export const notificationStore: NotificationStore = new NotificationStore()
