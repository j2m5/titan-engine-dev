import { describe, it, expect, vi, afterEach } from 'vitest'
import { engineStore } from '@/ui/mobx/EngineStore'
import { notificationStore } from '@/ui/mobx/NotificationStore'
import { Scenarios } from '@/config/scenarios'
import type { Application } from '@/Application'

describe('EngineStore.loadingPercentage', () => {
  afterEach(() => {
    engineStore.setTotal(0)
    engineStore.setProgress(0)
  })

  it('пока «всего» неизвестно (0) — ровно 0, а не NaN или Infinity', () => {
    engineStore.setTotal(0)
    engineStore.setProgress(3)

    expect(engineStore.loadingPercentage).toBe(0)
  })

  it('доля в процентах', () => {
    engineStore.setTotal(10)
    engineStore.setProgress(5)

    expect(engineStore.loadingPercentage).toBe(50)
  })

  it('зажата в 100', () => {
    engineStore.setTotal(10)
    engineStore.setProgress(12)

    expect(engineStore.loadingPercentage).toBe(100)
  })
})

describe('EngineStore.setScenario — сценарий не загрузился', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    notificationStore.notifications = []
    await engineStore.initialize(null as unknown as Application)
  })

  it('уведомляет, возвращает в меню и снимает экран загрузки вместо вечного ожидания', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = {
      run: vi.fn(() => Promise.reject(new Error('boom'))),
      dispose: vi.fn()
    } as unknown as Application

    await engineStore.initialize(app)
    await engineStore.setScenario(Scenarios[0])

    expect(engineStore.scenario).toBeNull()
    expect(engineStore.appLoadingStatus).toBe(false)
    expect(app.dispose).toHaveBeenCalledTimes(1)
    expect(notificationStore.notifications.map((n) => n.type)).toEqual(['error'])
    expect(notificationStore.notifications[0].message).toContain(Scenarios[0].name)
  })
})
