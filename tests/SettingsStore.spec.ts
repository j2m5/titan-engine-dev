import { describe, it, expect, beforeEach } from 'vitest'
import { settingsStore } from '@/ui/mobx/SettingsStore'

describe('SettingsStore', () => {
  beforeEach(() => {
    settingsStore.showOrbitLines = true
    settingsStore.showMarkers = true
  })

  it('по умолчанию включает орбитальные линии и маркеры', () => {
    expect(settingsStore.showOrbitLines).toBe(true)
    expect(settingsStore.showMarkers).toBe(true)
  })

  it('toggle переключает только указанное поле', () => {
    settingsStore.toggle('showOrbitLines')
    expect(settingsStore.showOrbitLines).toBe(false)
    expect(settingsStore.showMarkers).toBe(true)
  })

  it('повторный toggle возвращает поле в исходное состояние', () => {
    settingsStore.toggle('showMarkers')
    settingsStore.toggle('showMarkers')
    expect(settingsStore.showMarkers).toBe(true)
  })
})
