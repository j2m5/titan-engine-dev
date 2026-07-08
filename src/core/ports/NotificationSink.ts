/** Уровень системного уведомления (совпадает с AlertType в TitanUI) */
export type NotificationType = 'info' | 'warning' | 'error' | 'success'

/** Полезная нагрузка системного уведомления */
export interface SystemNotification {
  type: NotificationType
  message: string
}

/**
 * Выходной порт: ядру нужен лишь способ отправить уведомление,
 * не зная про MobX-стор или React.
 */
export interface NotificationSink {
  dispatch(notification: SystemNotification): void
}
