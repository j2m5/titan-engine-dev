import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { notificationStore } from '@/ui/mobx/NotificationStore'

beforeEach(() => {
  // Стор — модульный синглтон, поэтому чистим очередь между тестами вручную.
  notificationStore.notifications.slice().forEach((n) => notificationStore.release(n.id))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NotificationStore — идентификаторы', () => {
  it('выдаёт разные id уведомлениям, отправленным в одну миллисекунду', () => {
    // Замораживаем часы: Date.now() вернёт одно и то же значение обоим вызовам.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'))

    notificationStore.dispatch({ type: 'error', message: 'первое' })
    notificationStore.dispatch({ type: 'error', message: 'второе' })

    const ids = notificationStore.notifications.map((n) => n.id)

    expect(new Set(ids).size).toBe(2)
  })

  it('release убирает только адресованное уведомление, а не однопакетных соседей', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'))

    notificationStore.dispatch({ type: 'error', message: 'первое' })
    notificationStore.dispatch({ type: 'error', message: 'второе' })

    notificationStore.release(notificationStore.notifications[0].id)

    expect(notificationStore.notifications.map((n) => n.message)).toEqual(['второе'])
  })
})
